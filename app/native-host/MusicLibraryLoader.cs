using System;
using System.Threading.Tasks;

namespace XM.Native {
    // Startup/list/refresh callers share a scan. Get never returns a placeholder
    // empty catalog while the initial network-folder scan is still running.
    internal sealed class MusicLibraryLoader {
        private readonly Func<Task<object>> scan;
        private readonly object gate = new object();
        private Task<object> current;
        internal MusicLibraryLoader(Func<Task<object>> scan) { this.scan = scan; }
        internal Task<object> Get() {
            lock (gate) { return current != null && !current.IsFaulted && !current.IsCanceled ? current : Refresh(); }
        }
        internal Task<object> Refresh() {
            lock (gate) {
                if (current != null && !current.IsCompleted) return current;
                return current = Run();
            }
        }
        private async Task<object> Run() { return await scan(); }
    }
}
