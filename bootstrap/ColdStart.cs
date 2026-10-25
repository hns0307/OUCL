using System;
using System.Linq;
internal static class ColdStart {
    static void Main(string[] args) {
        Launcher.Arguments = args.Skip(1).ToArray();
        Launcher.Run(Console.WriteLine, System.IO.Path.GetFullPath(args[0]));
    }
}
