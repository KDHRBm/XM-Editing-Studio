using System;
using System.IO;

namespace XM.Native {
    // Stores only the entry address. Account sessions remain in WebView2's profile.
    internal static class CompanyDSH {
        internal static string Normalize(string value) {
            Uri uri;
            if (string.IsNullOrWhiteSpace(value) || value.Length > 2048 || !Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri) ||
                (uri.Scheme != "https" && uri.Scheme != "http") || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0)
                throw new Exception("请输入完整的 HTTP/HTTPS 公司入口地址，不要包含账号密码、登录票据或查询参数。");
            if (uri.Scheme == "http" && !PrivateHost(uri.Host)) throw new Exception("HTTP 入口仅支持内网 IP 或 localhost；公网入口请使用 HTTPS。");
            if (uri.AbsolutePath.StartsWith("/auth", StringComparison.OrdinalIgnoreCase) || uri.AbsolutePath.StartsWith("/api", StringComparison.OrdinalIgnoreCase))
                throw new Exception("请填写公司入口首页，不要填写登录回调或 API 地址。");
            return uri.AbsoluteUri;
        }
        private static bool PrivateHost(string host) {
            if (host == "localhost" || host == "[::1]") return true;
            System.Net.IPAddress ip;
            if (!System.Net.IPAddress.TryParse(host, out ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
            byte[] b = ip.GetAddressBytes();
            return b[0] == 10 || b[0] == 127 || b[0] == 192 && b[1] == 168 || b[0] == 172 && b[1] >= 16 && b[1] <= 31;
        }
        internal static bool Workspace(string entry, string value) {
            Uri root, uri;
            return Uri.TryCreate(entry, UriKind.Absolute, out root) && Uri.TryCreate(value, UriKind.Absolute, out uri) &&
                uri.UserInfo.Length == 0 && uri.Scheme == root.Scheme && uri.Host == root.Host &&
                !uri.AbsolutePath.StartsWith("/auth", StringComparison.OrdinalIgnoreCase) && !uri.AbsolutePath.StartsWith("/api", StringComparison.OrdinalIgnoreCase);
        }
        internal static bool Navigation(string entry, string value) {
            if (value == "about:blank") return true;
            Uri root, uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.UserInfo.Length != 0) return false;
            // HTTPS identity pages can navigate, but never receive automation scripts or local APIs.
            return uri.Scheme == "https" || uri.Scheme == "http" && Uri.TryCreate(entry, UriKind.Absolute, out root) && root.Scheme == "http" && root.Host == uri.Host;
        }
    }
    internal sealed partial class StudioHost {
        private string DshConfigPath { get { return Path.Combine(DataDir, "company-dsh.json"); } }
        private string DshEntry() { return J.Str(J.Read(DshConfigPath, null), "entryUrl"); }
        private object DshConfig() { return J.Obj("entryUrl", DshEntry()); }
        private object SaveDshEntry(string value) {
            string entry = CompanyDSH.Normalize(value);
            if (entry == DshEntry()) return DshConfig();
            aiInput.Invalidate(); ++aiLayoutGeneration;
            Microsoft.Web.WebView2.WinForms.WebView2 view;
            if (aiViews.TryGetValue("dsh", out view)) { BrowserInput.Hide(view, MainView); MainWindow.Controls.Remove(view); view.Dispose(); aiViews.Remove("dsh"); }
            aiReady.Remove("dsh"); aiErrors.Remove("dsh"); aiLoading.Remove("dsh");
            if (activeAi == "dsh") activeAi = "";
            if (requestedAi == "dsh") requestedAi = "";
            J.Save(DshConfigPath, J.Obj("version", 1, "entryUrl", entry));
            return DshConfig();
        }
    }
}
