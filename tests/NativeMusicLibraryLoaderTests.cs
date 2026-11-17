using System;
using System.Threading.Tasks;
using XM.Native;

internal static class NativeMusicLibraryLoaderTests {
    private static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
    private static void Main() { Run().GetAwaiter().GetResult(); Console.WriteLine("Music startup, refresh, failures and concurrent reads passed"); }
    private static async Task Run() {
        int calls = 0;
        var pending = new TaskCompletionSource<object>();
        var loader = new MusicLibraryLoader(() => { calls++; return pending.Task; });
        var initial = loader.Get();
        Check(!initial.IsCompleted, "Startup must await the slow network scan");
        Check(Object.ReferenceEquals(initial, loader.Get()), "A second page must share startup scan");
        Check(Object.ReferenceEquals(initial, loader.Refresh()), "Refresh must not duplicate an active scan");
        Check(calls == 1, "Only one filesystem scan");
        var first = new object(); pending.SetResult(first);
        Check(Object.ReferenceEquals(await initial, first), "Real catalog returned");
        Check(Object.ReferenceEquals(await loader.Get(), first), "Later readers see completed scan");
        pending = new TaskCompletionSource<object>();
        var refresh = loader.Refresh();
        Check(!refresh.IsCompleted && calls == 2, "Refresh starts exactly one new scan");
        Check(Object.ReferenceEquals(loader.Get(), refresh), "Analysis waits for current refresh");
        var second = new object(); pending.SetResult(second);
        Check(Object.ReferenceEquals(await refresh, second), "Refreshed catalog visible");
        pending = new TaskCompletionSource<object>(); var failing = loader.Refresh(); pending.SetException(new Exception("offline"));
        try { await failing; throw new Exception("Failure was swallowed"); } catch (Exception e) { Check(e.Message == "offline", "Failure is surfaced"); }
        pending = new TaskCompletionSource<object>(); var retry = loader.Get(); pending.SetResult(first);
        Check(Object.ReferenceEquals(await retry, first) && calls == 4, "Failed startup can recover");
    }
}
