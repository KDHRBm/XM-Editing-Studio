using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using XM.Native;

internal static class NativeMusicDirectoriesTests {
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static void Reject(Action action) { try { action(); } catch (IOException) { return; } throw new Exception("Invalid drop was accepted"); }
    static int Main() {
        string root = Path.Combine(Path.GetTempPath(), "xm-music-drop-" + Guid.NewGuid().ToString("N"));
        try {
            string first = Path.Combine(root, "中文 音乐库"), second = Path.Combine(root, "Spanish Music");
            Directory.CreateDirectory(first); Directory.CreateDirectory(second);
            var original = new List<string> { first };
            var merged = MusicDirectories.Merge(original, new[] { first + "\\", second, second.ToUpperInvariant() });
            Check(merged.SequenceEqual(new[] { first, second }), "Duplicate and trailing separator folders must not duplicate libraries");
            Check(original.SequenceEqual(new[] { first }), "Input list must remain unchanged");
            string file = Path.Combine(root, "song.mp3"); File.WriteAllText(file, "fixture");
            Reject(() => MusicDirectories.Merge(original, new[] { second, file }));
            Reject(() => MusicDirectories.Merge(original, new[] { Path.Combine(root, "missing") }));
            Reject(() => MusicDirectories.Merge(original, new[] { "relative" }));
            Reject(() => MusicDirectories.Merge(original, new string[0]));
            Reject(() => MusicDirectories.Merge(original, Enumerable.Repeat(first, 21)));
            Check(original.Count == 1 && original[0] == first, "Rejected mixed drop must be atomic");
            string drive = Path.GetPathRoot(root);
            Check(MusicDirectories.Merge(new string[0], new[] { drive }).Single() == drive, "Drive root must retain separator");
            Console.WriteLine("Native music folder validation passed"); return 0;
        } finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
