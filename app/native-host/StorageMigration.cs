using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace XM.Native {
    internal static class StorageMigration {
        internal static async Task Import(CoreWebView2 core, string profile, string client) {
            string source = Path.Combine(profile, "native-migration.json"), flag = Path.Combine(profile, "native-migrated.flag");
            if (!File.Exists(source) || File.Exists(flag)) return;
            var payload = J.Map(J.Read(source, J.Obj()));
            string code = File.ReadAllText(Path.Combine(client, "assets", "storage-migration.js"));
            await core.ExecuteScriptAsync(code + ";window.__xmMigration=null;importLegacyState(" + J.Encode(payload) + ").then(value=>window.__xmMigration={result:value},error=>window.__xmMigration={error:error.message});");
            for (int n = 0; n < 1200; n++) {
                await Task.Delay(100); var raw = await core.ExecuteScriptAsync("window.__xmMigration"); if (raw == "null") continue;
                var result = J.Decode(raw); if (J.Str(result, "error").Length > 0) throw new Exception(J.Str(result, "error"));
                if (J.Get(result, "result") == null) throw new Exception("迁移结果为空。");
                J.Save(Path.Combine(profile, "native-migration-report.json"), J.Get(result, "result")); File.WriteAllText(flag, DateTime.UtcNow.ToString("o")); return;
            }
            throw new TimeoutException("数据迁移超时，旧数据仍保留。");
        }
    }
    // Installer verification imports into a fresh private profile. It never loads
    // the application, starts jobs, accesses providers, or changes the old profile.
    internal sealed class MigrationVerifier : ApplicationContext {
        private readonly Form window;
        private readonly WebView2 view;
        internal MigrationVerifier(string profile) {
            window = new Form { Width = 1, Height = 1, Opacity = 0, ShowInTaskbar = false };
            view = new WebView2 { Dock = DockStyle.Fill }; window.Controls.Add(view);
            window.Shown += async (s, e) => {
                try {
                    string client = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "resources", "client");
                    var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(profile, "native-webview", "main"));
                    await view.EnsureCoreWebView2Async(environment);
                    view.CoreWebView2.SetVirtualHostNameToFolderMapping("xm.local", client, CoreWebView2HostResourceAccessKind.DenyCors);
                    view.CoreWebView2.NavigationCompleted += async (_s, nav) => {
                        try { if (!nav.IsSuccess) throw new Exception(nav.WebErrorStatus.ToString()); await StorageMigration.Import(view.CoreWebView2, profile, client); }
                        catch (Exception error) { Environment.ExitCode = 1; J.Save(Path.Combine(profile, "native-migration-error.json"), J.Obj("error", error.Message)); }
                        finally { view.Dispose(); window.Dispose(); ExitThread(); }
                    };
                    view.CoreWebView2.Navigate(StudioHost.Origin + "/native-migrate.html");
                } catch (Exception error) { Environment.ExitCode = 1; J.Save(Path.Combine(profile, "native-migration-error.json"), J.Obj("error", error.Message)); window.Dispose(); ExitThread(); }
            };
            window.Show();
        }
    }
}
