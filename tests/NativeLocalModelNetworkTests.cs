using System;
using System.Diagnostics;
using System.Linq;
using XM.Native;

internal static class NativeLocalModelNetworkTests {
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static ProcessStartInfo Child() {
        var info = new ProcessStartInfo(System.Reflection.Assembly.GetExecutingAssembly().Location, "--child") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true
        };
        info.EnvironmentVariables.Remove("HTTPS_PROXY");
        info.EnvironmentVariables.Remove("HTTP_PROXY");
        info.EnvironmentVariables.Remove("NO_PROXY");
        return info;
    }
    private static int Main(string[] args) {
        if (args.Length > 0 && args[0] == "--child") {
            Console.WriteLine(Environment.GetEnvironmentVariable("HTTPS_PROXY"));
            Console.WriteLine(Environment.GetEnvironmentVariable("NO_PROXY"));
            return 0;
        }
        try {
            var system = Child();
            system.EnvironmentVariables["NO_PROXY"] = "example.org,LOCALHOST";
            LocalModelNetwork.Configure(system, target => {
                Check(target.AbsoluteUri == "https://registry.ollama.ai/", "resolve the actual model registry route");
                return new Uri("http://127.0.0.1:7890");
            });
            Check(system.EnvironmentVariables["HTTPS_PROXY"] == "http://127.0.0.1:7890/", "Windows proxy reaches launch configuration");
            Check(system.EnvironmentVariables["HTTP_PROXY"] == null, "do not add HTTP_PROXY");
            Check(system.EnvironmentVariables["NO_PROXY"] == "example.org,LOCALHOST,127.0.0.1,::1", "preserve bypasses and append loopback once");
            using (var child = Process.Start(system)) {
                string output = child.StandardOutput.ReadToEnd();
                Check(child.WaitForExit(5000) && child.ExitCode == 0, "child process exits");
                Check(output.Contains("http://127.0.0.1:7890/") && output.Contains("127.0.0.1,::1"), "actual child inherits HTTPS proxy and loopback bypass");
            }
            var explicitProxy = Child();
            explicitProxy.EnvironmentVariables["https_proxy"] = "http://manual.example:3128";
            explicitProxy.EnvironmentVariables["HTTP_PROXY"] = "http://existing.example:8080";
            LocalModelNetwork.Configure(explicitProxy, target => { throw new Exception("must not resolve Windows proxy when explicitly configured"); });
            Check(explicitProxy.EnvironmentVariables["HTTPS_PROXY"] == "http://manual.example:3128", "explicit proxy wins, including Windows case-insensitive keys");
            Check(explicitProxy.EnvironmentVariables["HTTP_PROXY"] == "http://existing.example:8080", "existing HTTP proxy preserved");
            foreach (var resolver in new Func<Uri, Uri>[] { target => target, target => null, target => new Uri("socks://127.0.0.1:7890"), target => new Uri("/relative", UriKind.Relative), target => { throw new InvalidOperationException("proxy unavailable"); } }) {
                var direct = Child();
                LocalModelNetwork.Configure(direct, resolver);
                Check(string.IsNullOrEmpty(direct.EnvironmentVariables["HTTPS_PROXY"]), "direct, unavailable or unsupported Windows proxy must not create a broken route");
                Check(direct.EnvironmentVariables["NO_PROXY"] == "localhost,127.0.0.1,::1", "loopback preserved without proxy");
            }
            var globalBypass = Child();
            globalBypass.EnvironmentVariables["NO_PROXY"] = "*";
            LocalModelNetwork.Configure(globalBypass, target => new Uri("https://proxy.example:443"));
            Check(globalBypass.EnvironmentVariables["NO_PROXY"].Split(',').Contains("*"), "explicit global bypass preserved");
            foreach (string ip in new[] { "198.18.0.37", "198.19.255.255" }) {
                string error = "max retries exceeded: Get https://cdn.r2.cloudflarestorage.com/blob?X-Amz-Signature=secret: redirect target not allowed: cdn.r2.cloudflarestorage.com resolves to non-public " + ip;
                string message = LocalModelNetwork.DownloadError(error);
                Check(message.Contains("Fake-IP") && message.Contains("系统代理") && message.Contains("停止") && message.Contains("启动"), "actionable Fake-IP guidance");
                Check(!message.Contains("secret") && !message.Contains("https://"), "do not display signed CDN URL");
            }
            foreach (string ip in new[] { "192.168.1.1", "198.20.0.1", "198.18.999.1" }) {
                string message = LocalModelNetwork.DownloadError("redirect target not allowed: cdn.example resolves to non-public " + ip);
                Check(!message.Contains("Fake-IP"), "other non-public or invalid IPs are not mislabeled");
            }
            Check(LocalModelNetwork.DownloadError("unexpected EOF").Contains("unexpected EOF"), "retain retryable error signal");
            Check(!LocalModelNetwork.DownloadError("redirect target not allowed: https registry redirecting to http").Contains("Fake-IP"), "scheme rejection stays rejected");
            string log = LocalModelNetwork.RedactLog("HTTPS_PROXY:http://alice:p%40ss@127.0.0.1:7890 NO_PROXY:localhost");
            Check(!log.Contains("alice") && !log.Contains("p%40ss") && log.Contains("127.0.0.1:7890"), "proxy credentials redacted in runtime logs");
            Console.WriteLine("PASS: proxy inheritance, explicit routes, loopback, child environment, Fake-IP diagnostics and redaction");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
