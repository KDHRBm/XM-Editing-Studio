using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using XM.Native;

internal static class NativeWebsiteUpdatesTests {
    static int checks;
    static void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; }
    static void Reject(Action action, string name) { bool rejected = false; try { action(); } catch { rejected = true; } Check(rejected, name); }
    static object Asset(string version, string kind) {
        string name = kind == "incremental" ? "XM-Editing-Studio-1.4.2-to-" + version + "-Incremental-20261102.zip" : "XM-Editing-Studio-" + version + "-Windows-x64-Setup.exe";
        return J.Obj("type", kind, "version", version, "fromVersion", kind == "incremental" ? "1.4.2" : "", "name", name, "url", "https://github.com/KDHRBm/XM-Editing-Studio/releases/download/v" + version + "/" + name, "sha", new string('a', 64), "size", 12345);
    }
    static object Feed() { return J.Obj("schemaVersion", 1, "downloads", J.Obj("installer", Asset("1.4.2", "installer"), "incremental", Asset("1.4.6", "incremental"))); }
    sealed class Handler : HttpMessageHandler {
        internal Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> Reply;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { token.ThrowIfCancellationRequested(); return Task.FromResult(Reply(request, token)); }
    }
    static async Task Network() {
        int calls = 0;
        var handler = new Handler { Reply = (request, token) => {
            calls++; Check(request.RequestUri.GetLeftPart(UriPartial.Path) == WebsiteUpdates.Feed, "Uses website feed");
            Check(request.Headers.CacheControl.NoCache && request.Headers.CacheControl.NoStore, "Fresh startup/manual check");
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(J.Encode(Feed())), RequestMessage = request };
        }};
        using (var http = new HttpClient(handler)) {
            Check(J.Str(await WebsiteUpdates.Check(http, "1.4.4", CancellationToken.None), "version") == "1.4.6", "HTTP update selection");
            await WebsiteUpdates.Check(http, "1.4.5", CancellationToken.None); Check(calls == 2, "Independent opens check again");
            handler.Reply = (request, token) => new HttpResponseMessage(HttpStatusCode.NotFound);
            bool failed = false; try { await WebsiteUpdates.Check(http, "1.4.4", CancellationToken.None); } catch (HttpRequestException) { failed = true; } Check(failed, "Network failure never reports latest");
            using (var cancel = new CancellationTokenSource()) { cancel.Cancel(); bool canceled = false; try { await WebsiteUpdates.Check(http, "1.4.4", cancel.Token); } catch (OperationCanceledException) { canceled = true; } Check(canceled, "Shutdown cancels check"); }
        }
    }
    static string Archive(string root, string name, string[] entries, bool symlink = false) {
        string file = Path.Combine(root, name + ".zip");
        using (var zip = ZipFile.Open(file, ZipArchiveMode.Create)) foreach (string entryName in entries) {
            var entry = zip.CreateEntry(entryName);
            if (symlink) entry.ExternalAttributes = unchecked((int)0xa1ff0000);
            using (var writer = new StreamWriter(entry.Open())) writer.Write("fixture");
        }
        return file;
    }
    static void Archives(string root) {
        string exe = "XM-Editing-Studio-1.4.6-Update.exe", payload = "payload/resources/client/index.html";
        string archive = Archive(root, "valid", new[] { "package/" + exe, "package/" + payload });
        string launched = WebsiteUpdates.PreparePatch(archive, Path.Combine(root, "updates"), "1.4.6", J.FileHash(archive));
        Check(File.Exists(launched) && File.Exists(Path.Combine(Path.GetDirectoryName(launched), payload)), "Extract updater and payload together");
        Reject(() => WebsiteUpdates.PreparePatch(archive, root, "1.4.6", new string('0', 64)), "Reject tampered ZIP");
        foreach (string entry in new[] { "../outside.txt", "/absolute.txt", "C:/outside.txt", "payload/name:stream", "payload/../outside.txt", "payload/trailing. " }) {
            archive = Archive(root, "invalid-" + checks, new[] { exe, payload, entry });
            Reject(() => WebsiteUpdates.PreparePatch(archive, root, "1.4.6", J.FileHash(archive)), "Reject unsafe archive path");
        }
        archive = Archive(root, "duplicate", new[] { exe, payload, payload.ToUpperInvariant() });
        Reject(() => WebsiteUpdates.PreparePatch(archive, root, "1.4.6", J.FileHash(archive)), "Reject case-colliding files");
        archive = Archive(root, "missing", new[] { payload });
        Reject(() => WebsiteUpdates.PreparePatch(archive, root, "1.4.6", J.FileHash(archive)), "Reject missing updater");
        archive = Archive(root, "link", new[] { exe, payload }, true);
        Reject(() => WebsiteUpdates.PreparePatch(archive, root, "1.4.6", J.FileHash(archive)), "Reject symlink");
    }
    static int Main(string[] args) {
        try {
            if (args.Length == 3 && args[0] == "--live") {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                using (var http = new HttpClient()) { http.DefaultRequestHeaders.UserAgent.ParseAdd("XM-Editing-Studio/1.4.6"); var result = WebsiteUpdates.Check(http, args[1], CancellationToken.None).GetAwaiter().GetResult(); Check((result == null ? "none" : J.Str(result, "version")) == args[2], "Published feed matches expected update"); Console.WriteLine(J.Encode(result)); return 0; }
            }
            object feed = Feed();
            foreach (string current in new[] { "1.4.2", "1.4.3", "1.4.4", "1.4.5" }) Check(J.Str(WebsiteUpdates.Select(feed, current), "type") == "incremental", "Cumulative patch for " + current);
            Check(WebsiteUpdates.Select(feed, "1.4.6") == null && WebsiteUpdates.Select(feed, "1.5.0") == null, "No repeat or downgrade");
            Check(J.Str(WebsiteUpdates.Select(feed, "1.3.1"), "type") == "installer", "Old major runtime gets full installer");
            J.Map(J.Get(feed, "downloads"))["installer"] = Asset("1.4.6", "installer"); Check(J.Str(WebsiteUpdates.Select(feed, "1.4.4"), "type") == "incremental", "Same release prefers patch");
            J.Map(J.Get(feed, "downloads"))["installer"] = Asset("1.4.7", "installer"); Check(J.Str(WebsiteUpdates.Select(feed, "1.4.4"), "version") == "1.4.7", "Later full installer is not hidden");
            foreach (var change in new[] { new[] { "sha", "" }, new[] { "url", "https://example.com/evil.exe" }, new[] { "version", "invalid" }, new[] { "size", "-1" }, new[] { "size", "1.5" }, new[] { "fromVersion", "9.0.0" }, new[] { "type", "installer" } }) {
                feed = Feed(); J.Map(J.Get(J.Get(feed, "downloads"), "incremental"))[change[0]] = change[1];
                Reject(() => WebsiteUpdates.Select(feed, "1.4.4"), "Reject invalid " + change[0]);
            }
            Reject(() => WebsiteUpdates.Select(J.Obj("schemaVersion", 1, "downloads", J.Obj("installer", null, "incremental", null)), "1.4.4"), "Reject empty feed");
            Network().GetAwaiter().GetResult(); Archives(args[0]); Console.WriteLine("PASS " + checks + " website update checks"); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
