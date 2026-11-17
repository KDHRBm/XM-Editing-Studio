using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using XM.Native;

internal static class NativeLocalRuntimeDownloadTests {
    private static readonly byte[] Zip = new byte[] { 0x50, 0x4b, 3, 4, 1, 2, 3, 4 };
    private static readonly string Url = "https://github.com/ollama/ollama/releases/download/v-test/ollama-windows-amd64.zip";
    private static int scenarios;
    private static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
    private static void Pass() { scenarios++; }
    private static HttpResponseMessage Response(byte[] bytes) { return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }; }
    private static HttpResponseMessage Partial() {
        var response = Response(Zip.Take(4).ToArray()); response.StatusCode = HttpStatusCode.PartialContent;
        response.Content.Headers.ContentRange = new ContentRangeHeaderValue(0, 3, Zip.Length); return response;
    }
    private static HttpResponseMessage Metadata(string url = null, string digest = null) {
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(J.Encode(J.Obj("assets", new[] {
            J.Obj("name", "ollama-windows-amd64.zip", "browser_download_url", url ?? Url, "size", Zip.Length, "digest", digest ?? ("sha256:" + J.Hash(Zip)))
        }))) };
    }
    private sealed class Handler : HttpMessageHandler {
        internal Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Route;
        internal List<string> Hosts = new List<string>();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
            Hosts.Add(request.RequestUri.Host); return Route(request, token);
        }
    }
    private sealed class BlockOfficial : DelegatingHandler {
        internal BlockOfficial() : base(new HttpClientHandler()) {}
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
            if (request.RequestUri.Host == "github.com") throw new HttpRequestException("force mirror for live verification");
            return base.SendAsync(request, token);
        }
    }
    private sealed class CountingStream : MemoryStream {
        internal int ReadBytes;
        internal CountingStream(byte[] bytes) : base(bytes) {}
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken token) {
            int result = await base.ReadAsync(buffer, offset, count, token); ReadBytes += result; return result;
        }
    }
    private sealed class StalledStream : MemoryStream {
        // Model a .NET network stream whose ReadAsync ignores the token: disposing
        // the HTTP response must still release a stalled read.
        private readonly TaskCompletionSource<int> stalled = new TaskCompletionSource<int>();
        internal Action OnRead;
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken token) { if (OnRead != null) OnRead(); return stalled.Task; }
        protected override void Dispose(bool disposing) { if (disposing) stalled.TrySetException(new IOException("disposed stalled stream")); base.Dispose(disposing); }
    }
    private static HttpResponseMessage StalledResponse(Action onRead = null) {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new StalledStream { OnRead = onRead }) };
        response.Content.Headers.ContentLength = Zip.Length; return response;
    }
    private static async Task<HttpResponseMessage> Stall(CancellationToken token) { await Task.Delay(Timeout.Infinite, token); throw new Exception("unreachable"); }
    private static async Task<Exception> Failure(Func<Task> action) {
        try { await action(); } catch (Exception error) { return error; }
        throw new Exception("Expected a failure");
    }
    private static async Task Run(string root) {
        var handler = new Handler { Route = (r, t) => Task.FromResult(Metadata()) };
        using (var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan }) {
            var asset = await LocalRuntimeDownload.GetAsset(client, CancellationToken.None, 5000);
            Check(asset.Size == Zip.Length && asset.Sha256 == J.Hash(Zip) && handler.Hosts.SequenceEqual(new[] { "api.github.com" }), "checksum must come from official API"); Pass();
            foreach (var invalid in new[] { Metadata("https://evil.example/ollama.zip"), Metadata(Url + "?redirect=evil"), Metadata(digest: "sha256:bad") }) {
                handler.Route = (r, t) => Task.FromResult(invalid);
                Check(await Failure(async () => { await LocalRuntimeDownload.GetAsset(client, CancellationToken.None); }) is InvalidDataException, "reject malformed official metadata");
            } Pass();
            handler.Route = (r, t) => Stall(t);
            Check(await Failure(async () => { await LocalRuntimeDownload.GetAsset(client, CancellationToken.None, 30); }) is TimeoutException, "metadata timeout is not user cancellation"); Pass();
            handler.Route = (r, t) => {
                Check(r.Method == HttpMethod.Get && r.Headers.Range.ToString() == "bytes=0-3", "probe uses bounded range, not HEAD");
                return Task.FromResult(Partial());
            };
            // Do not measure cold CLR/JIT speed on shared CI runners. Short clocks
            // below are reserved for deliberately blocked requests, never success.
            Check(await LocalRuntimeDownload.Probe(client, asset, CancellationToken.None, 5000) == "官方地址", "official probe succeeds"); Pass();
            handler.Hosts.Clear(); handler.Route = (r, t) => r.RequestUri.Host == "github.com" ? Stall(t) : Task.FromResult(Partial());
            Check(await LocalRuntimeDownload.Probe(client, asset, CancellationToken.None, 1000) == "国内镜像" && handler.Hosts.Count == 2, "fresh timeout budget for fallback"); Pass();
            var stream = new CountingStream(Zip);
            handler.Route = (r, t) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(stream) });
            Check(await LocalRuntimeDownload.Probe(client, asset, CancellationToken.None) == "官方地址" && stream.ReadBytes == 4, "server ignoring range must not cause full download"); Pass();
            foreach (bool html in new[] { false, true }) {
                handler.Route = (r, t) => {
                    if (r.RequestUri.Host == "gh-proxy.com") return Task.FromResult(Partial());
                    var bad = html ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>challenge</html>") } : Partial();
                    if (!html) bad.Content.Headers.ContentRange = new ContentRangeHeaderValue(0, 3, 999);
                    return Task.FromResult(bad);
                };
                Check(await LocalRuntimeDownload.Probe(client, asset, CancellationToken.None) == "国内镜像", "reject HTML and inconsistent range");
            } Pass();
            handler.Route = (r, t) => Stall(t);
            Exception error = await Failure(async () => { await LocalRuntimeDownload.Probe(client, asset, CancellationToken.None, 30); });
            Check(error is TimeoutException && error.Message.Contains("官方地址连接超时") && error.Message.Contains("国内镜像连接超时") && !error.Message.Contains("已取消"), "all-source timeout has actionable diagnostics"); Pass();
            handler.Hosts.Clear();
            using (var cts = new CancellationTokenSource()) {
                handler.Route = (r, t) => { cts.Cancel(); return Stall(t); };
                error = await Failure(async () => { await LocalRuntimeDownload.Probe(client, asset, cts.Token, 1000); });
                Check(error is OperationCanceledException && handler.Hosts.Count == 1, "user cancellation must not try mirror");
            } Pass();
            string target = Path.Combine(root, "runtime.zip");
            var phases = new List<string>();
            handler.Route = (r, t) => r.RequestUri.Host == "github.com" ? Stall(t) : Task.FromResult(Response(Zip));
            await LocalRuntimeDownload.Download(client, asset, target, CancellationToken.None, (p, m, c, total) => phases.Add(p + " " + m), 1000, 5000);
            Check(J.FileHash(target) == asset.Sha256 && phases.Any(p => p.Contains("国内镜像")) && phases.Any(p => p.StartsWith("verify")), "actual download uses fallback and checksum"); Pass();
            handler.Route = (r, t) => Task.FromResult(Response(r.RequestUri.Host == "github.com" ? Zip.Take(4).ToArray() : Zip));
            await LocalRuntimeDownload.Download(client, asset, target, CancellationToken.None, null);
            Check(J.FileHash(target) == asset.Sha256, "truncated source recovered"); Pass();
            handler.Route = (r, t) => Task.FromResult(Response(Enumerable.Repeat((byte)0, Zip.Length).ToArray()));
            error = await Failure(() => LocalRuntimeDownload.Download(client, asset, target, CancellationToken.None, null));
            Check(error.Message.Contains("SHA-256") && !File.Exists(target), "bad hash on both routes must never leave an installable archive"); Pass();
            handler.Route = (r, t) => {
                if (r.RequestUri.Host == "gh-proxy.com") return Task.FromResult(Response(Zip));
                return Task.FromResult(StalledResponse());
            };
            await LocalRuntimeDownload.Download(client, asset, target, CancellationToken.None, null, 5000, 1000);
            Check(J.FileHash(target) == asset.Sha256, "idle timeout closes stream and moves to mirror"); Pass();
            handler.Hosts.Clear(); handler.Route = (r, t) => Task.FromResult(StalledResponse());
            using (var cts = new CancellationTokenSource()) {
                handler.Route = (r, t) => Task.FromResult(StalledResponse(() => cts.Cancel()));
                error = await Failure(() => LocalRuntimeDownload.Download(client, asset, target, cts.Token, null, 5000, 5000));
                Check(error is OperationCanceledException && handler.Hosts.Count == 1 && !File.Exists(target), "cancelled body read cleans partial file without fallback");
            } Pass();
            handler.Route = (r, t) => r.RequestUri.Host == "github.com" ? Task.FromResult(StalledResponse()) : Task.FromResult(Partial());
            Check(await LocalRuntimeDownload.Probe(client, asset, CancellationToken.None, 1000) == "国内镜像", "probe idle body also bounded"); Pass();
            handler.Route = (r, t) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)429));
            error = await Failure(async () => { await LocalRuntimeDownload.GetAsset(client, CancellationToken.None); });
            Check(error.Message.Contains("HTTP 429") && !error.Message.Contains("已取消"), "rate limiting must not be labeled cancellation"); Pass();
        }
    }
    private static async Task Live() {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        using (var client = new HttpClient() { Timeout = Timeout.InfiniteTimeSpan })
        using (var mirror = new HttpClient(new BlockOfficial()) { Timeout = Timeout.InfiniteTimeSpan }) {
            client.DefaultRequestHeaders.UserAgent.ParseAdd("XM-Source-Check/1.6.4");
            mirror.DefaultRequestHeaders.UserAgent.ParseAdd("XM-Source-Check/1.6.4");
            var asset = await LocalRuntimeDownload.GetAsset(client, CancellationToken.None);
            Console.WriteLine("Official metadata: " + asset.Url + " bytes=" + asset.Size);
            Console.WriteLine("Automatic probe: " + await LocalRuntimeDownload.Probe(client, asset, CancellationToken.None));
            Console.WriteLine("Mirror probe: " + await LocalRuntimeDownload.Probe(mirror, asset, CancellationToken.None));
        }
    }
    private static int Main(string[] args) {
        string root = Path.Combine(Path.GetTempPath(), "xm-runtime-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try {
            if (args.Length == 1 && args[0] == "--live") { Live().GetAwaiter().GetResult(); return 0; }
            Run(root).GetAwaiter().GetResult(); Console.WriteLine("PASS: " + scenarios + " runtime download scenarios"); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Directory.Delete(root, true); }
    }
}
