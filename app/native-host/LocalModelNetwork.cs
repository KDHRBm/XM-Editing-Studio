using System;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;

namespace XM.Native {
    internal static class LocalModelNetwork {
        private static readonly Uri Registry = new Uri("https://registry.ollama.ai/");

        internal static void Configure(ProcessStartInfo info) {
            Configure(info, target => {
                var proxy = WebRequest.GetSystemWebProxy();
                return proxy == null ? target : proxy.GetProxy(target);
            });
        }

        internal static void Configure(ProcessStartInfo info, Func<Uri, Uri> resolveSystemProxy) {
            // Go does not read Windows' system proxy. Copy only the HTTPS route into
            // this child; never change the user's environment or proxy settings.
            if (string.IsNullOrWhiteSpace(info.EnvironmentVariables["HTTPS_PROXY"])) {
                try {
                    var proxy = resolveSystemProxy(Registry);
                    if (proxy != null && proxy.IsAbsoluteUri && !proxy.Equals(Registry)
                        && (proxy.Scheme == Uri.UriSchemeHttp || proxy.Scheme == Uri.UriSchemeHttps)) {
                        info.EnvironmentVariables["HTTPS_PROXY"] = proxy.AbsoluteUri;
                    }
                } catch {
                    // Unavailable PAC/system proxy must not prevent offline inference.
                }
            }
            string bypass = info.EnvironmentVariables["NO_PROXY"] ?? "";
            foreach (string host in new[] { "localhost", "127.0.0.1", "::1" }) {
                if (!bypass.Split(',').Any(value => value.Trim().Equals(host, StringComparison.OrdinalIgnoreCase)))
                    bypass = string.IsNullOrWhiteSpace(bypass) ? host : bypass.TrimEnd(',') + "," + host;
            }
            info.EnvironmentVariables["NO_PROXY"] = bypass;
        }

        internal static string DownloadError(string error) {
            if (error.IndexOf("redirect target not allowed", StringComparison.OrdinalIgnoreCase) >= 0) {
                var match = Regex.Match(error, @"resolves to non-public\s+((?:\d{1,3}\.){3}\d{1,3})(?![\d.])", RegexOptions.IgnoreCase);
                IPAddress address;
                if (match.Success && IPAddress.TryParse(match.Groups[1].Value, out address)) {
                    byte[] bytes = address.GetAddressBytes();
                    if (bytes.Length == 4 && bytes[0] == 198 && (bytes[1] == 18 || bytes[1] == 19)) {
                        return "模型下载被代理的 Fake-IP 地址拦截。请在代理软件中开启“系统代理”（HTTP／混合端口），然后在“本地部署”点击“停止”再“启动”，重新下载。若仍失败，请关闭 TUN／虚拟网卡模式后重试，并保持系统代理可用。";
                    }
                }
                return "模型下载地址被安全检查拒绝。请检查代理或 DNS 设置，确认下载域名没有被解析到内网地址；调整后在“本地部署”停止并重新启动服务再试。";
            }
            return "模型下载失败：" + RedactLog(error);
        }

        internal static string RedactLog(string message) {
            return Regex.Replace(message ?? "", @"(?i)((?:https?|socks5h?)://)[^\s/""<>]*@", "$1[已隐藏]@");
        }
    }
}
