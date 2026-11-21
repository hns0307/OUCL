using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Text.RegularExpressions;

internal sealed class GuardError : Exception
{
    internal readonly string Code;
    internal GuardError(string code) { Code = code; }
}

// Deliberately small JSON grammar for this one request. Duplicate keys, arrays, null and fractional/exponential numbers are rejected.
internal sealed class RequestJson
{
    readonly string text;
    int position;
    internal RequestJson(string text) { this.text = text; }
    void Space() { while (position < text.Length && " \r\n\t".IndexOf(text[position]) >= 0) position++; }
    void Take(char expected) { Space(); if (position >= text.Length || text[position++] != expected) throw new GuardError("INVALID_REQUEST"); }
    string String()
    {
        Take('"'); var result = new StringBuilder();
        while (position < text.Length)
        {
            char value = text[position++];
            if (value == '"') return result.ToString();
            if (value < 32) throw new GuardError("INVALID_REQUEST");
            if (value == '\\')
            {
                if (position >= text.Length) throw new GuardError("INVALID_REQUEST");
                value = text[position++];
                switch (value)
                {
                    case '"': case '\\': case '/': break;
                    case 'b': value = '\b'; break; case 'f': value = '\f'; break;
                    case 'n': value = '\n'; break; case 'r': value = '\r'; break; case 't': value = '\t'; break;
                    case 'u':
                        if (position + 4 > text.Length) throw new GuardError("INVALID_REQUEST");
                        ushort code; if (!UInt16.TryParse(text.Substring(position, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code)) throw new GuardError("INVALID_REQUEST");
                        value = (char)code; position += 4; break;
                    default: throw new GuardError("INVALID_REQUEST");
                }
            }
            result.Append(value); if (result.Length > 4096) throw new GuardError("INVALID_REQUEST");
        }
        throw new GuardError("INVALID_REQUEST");
    }
    object Value(int depth)
    {
        Space(); if (depth > 3 || position >= text.Length) throw new GuardError("INVALID_REQUEST");
        if (text[position] == '"') return String();
        if (text[position] == '{')
        {
            position++; var value = new Dictionary<string, object>(StringComparer.Ordinal); Space();
            if (position < text.Length && text[position] == '}') { position++; return value; }
            while (true)
            {
                string key = String(); if (value.ContainsKey(key) || value.Count >= 12) throw new GuardError("INVALID_REQUEST");
                Take(':'); value.Add(key, Value(depth + 1)); Space();
                if (position < text.Length && text[position] == '}') { position++; return value; } Take(',');
            }
        }
        int start = position;
        while (position < text.Length && text[position] >= '0' && text[position] <= '9') position++;
        long number;
        if (position == start || position - start > 1 && text[start] == '0'
            || !Int64.TryParse(text.Substring(start, position - start), NumberStyles.None, CultureInfo.InvariantCulture, out number)) throw new GuardError("INVALID_REQUEST");
        return number;
    }
    internal Dictionary<string, object> Parse()
    {
        var value = Value(0) as Dictionary<string, object>; Space();
        if (value == null || position != text.Length) throw new GuardError("INVALID_REQUEST"); return value;
    }
}

internal sealed class Request
{
    internal string Operation, Root, TxId, LeaseToken, Source, Destination, RootDev, RootIno;
    internal NativeGuard.Proof Expected;
    static readonly Regex Uuid = new Regex("^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", RegexOptions.CultureInvariant);
    static readonly Regex Hash = new Regex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    static readonly Regex Decimal = new Regex("^(0|[1-9][0-9]{0,19})$", RegexOptions.CultureInvariant);
    static readonly Regex Stage = new Regex("^(0|[1-9][0-9]{0,3})\\.(new|old|rollback)$", RegexOptions.CultureInvariant);
    static void Exact(Dictionary<string, object> value, params string[] names)
    {
        if (value == null || value.Count != names.Length) throw new GuardError("INVALID_REQUEST");
        foreach (string name in names) if (!value.ContainsKey(name)) throw new GuardError("INVALID_REQUEST");
    }
    static string Text(Dictionary<string, object> value, string key)
    {
        object item; if (!value.TryGetValue(key, out item) || !(item is string)) throw new GuardError("INVALID_REQUEST"); return (string)item;
    }
    static string Identity(Dictionary<string, object> value, string key, bool nonzero)
    {
        string result = Text(value, key); ulong number;
        if (!Decimal.IsMatch(result) || !UInt64.TryParse(result, NumberStyles.None, CultureInfo.InvariantCulture, out number) || nonzero && number == 0)
            throw new GuardError("INVALID_REQUEST"); return result;
    }
    static string FullPath(string value)
    {
        if (value.Length < 4 || value.Length > 4096 || value[1] != ':' || value[2] != '\\' || !Char.IsLetter(value[0]) || value.IndexOf('/') >= 0 || value.IndexOf(':', 2) >= 0
            || !String.Equals(Path.GetFullPath(value), value, StringComparison.OrdinalIgnoreCase)) throw new GuardError("UNSAFE_PATH");
        foreach (string part in value.Substring(3).Split('\\'))
        {
            string stem = part.Split('.')[0].ToUpperInvariant();
            if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                || stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || Regex.IsMatch(stem, "^(COM|LPT)[1-9]$")) throw new GuardError("UNSAFE_PATH");
        }
        return value;
    }
    internal void Allowed(string value, bool release)
    {
        if (!value.StartsWith(Root + "\\", StringComparison.OrdinalIgnoreCase)) throw new GuardError("UNSAFE_PATH");
        string relative = value.Substring(Root.Length + 1);
        if (release) { if (relative != "oucl.session.lock") throw new GuardError("UNSAFE_PATH"); return; }
        string[] parts = relative.Split('\\');
        if (parts.Length >= 2 && (parts[0] == "mods" || parts[0] == "resourcepacks" || parts[0] == "config")) return;
        if (parts.Length == 3 && parts[0] == ".oucl-distribution-staging" && parts[1] == TxId && Stage.IsMatch(parts[2]))
        {
            if (Int32.Parse(parts[2].Split('.')[0], CultureInfo.InvariantCulture) <= 4095) return;
        }
        throw new GuardError("UNSAFE_PATH");
    }
    internal static Request Parse(Dictionary<string, object> value)
    {
        string operation = Text(value, "operation"); bool destination = operation == "rename" || operation == "link";
        if (!destination && operation != "delete" && operation != "release") throw new GuardError("INVALID_REQUEST");
        if (destination) Exact(value, "version", "operation", "root", "txId", "rootIdentity", "leaseToken", "source", "destination", "expected");
        else Exact(value, "version", "operation", "root", "txId", "rootIdentity", "leaseToken", "source", "expected");
        if (!(value["version"] is long) || (long)value["version"] != 1) throw new GuardError("UNSUPPORTED_VERSION");
        var rootIdentity = value["rootIdentity"] as Dictionary<string, object>; var expected = value["expected"] as Dictionary<string, object>;
        Exact(rootIdentity, "dev", "ino"); Exact(expected, "dev", "ino", "sha256", "size");
        var request = new Request { Operation = operation, Root = FullPath(Text(value, "root")), TxId = Text(value, "txId"), LeaseToken = Text(value, "leaseToken"),
            RootDev = Identity(rootIdentity, "dev", false), RootIno = Identity(rootIdentity, "ino", true), Source = FullPath(Text(value, "source")) };
        if (!Uuid.IsMatch(request.TxId) || !Uuid.IsMatch(request.LeaseToken)) throw new GuardError("INVALID_REQUEST");
        if (!(expected["size"] is long) || (long)expected["size"] > 1024L * 1024 * 1024 || !Hash.IsMatch(Text(expected, "sha256"))) throw new GuardError("INVALID_REQUEST");
        request.Expected = new NativeGuard.Proof { Volume = Identity(expected, "dev", false), Inode = Identity(expected, "ino", true), Sha256 = Text(expected, "sha256"), Size = (long)expected["size"] };
        request.Allowed(request.Source, operation == "release");
        if (destination) { request.Destination = FullPath(Text(value, "destination")); request.Allowed(request.Destination, false); if (String.Equals(request.Source, request.Destination, StringComparison.OrdinalIgnoreCase)) throw new GuardError("INVALID_REQUEST"); }
        return request;
    }
}

internal static class Program
{
    static void VerifyProof(NativeGuard.Proof actual, NativeGuard.Proof expected)
    {
        if (actual.Volume != expected.Volume || actual.Inode != expected.Inode || actual.Size != expected.Size || actual.Sha256 != expected.Sha256) throw new GuardError("PROOF_MISMATCH");
    }
    static void Execute(Request request)
    {
        using (var root = new NativeGuard.Chain(request.Root))
        using (var sourceChain = new NativeGuard.Chain(Path.GetDirectoryName(request.Source)))
        using (var destinationChain = request.Destination == null ? null : new NativeGuard.Chain(Path.GetDirectoryName(request.Destination)))
        {
            var identity = root.LastIdentity;
            if (identity.Volume.ToString(CultureInfo.InvariantCulture) != request.RootDev || (((ulong)identity.IndexHigh << 32) | identity.IndexLow).ToString(CultureInfo.InvariantCulture) != request.RootIno) throw new GuardError("ROOT_CHANGED");
            NativeGuard.SameVolume(root, sourceChain); if (destinationChain != null) NativeGuard.SameVolume(root, destinationChain);
            string leasePath = Path.Combine(request.Root, "oucl.session.lock");
            using (var lease = NativeGuard.Open(leasePath, false, 1, request.Operation != "release"))
            {
                if (NativeGuard.LeaseToken(lease) != request.LeaseToken) throw new GuardError("LEASE_MISMATCH");
                using (var source = request.Operation == "release" ? null : NativeGuard.Open(request.Source, false, 2))
                {
                    var held = source ?? lease; var actual = NativeGuard.Capture(held, request.Operation == "release" ? 1u : 2u); VerifyProof(actual, request.Expected);
                    int error;
                    if (request.Operation == "rename") error = NativeGuard.Rename(held, actual, sourceChain, destinationChain, request.Destination);
                    else if (request.Operation == "link") error = NativeGuard.LinkExact(held, actual, sourceChain, destinationChain, request.Source, request.Destination);
                    else error = NativeGuard.DeleteExact(held, actual, sourceChain);
                    if (error != 0) throw new Win32Exception(error);
                }
            }
        }
    }
    static string Error(Exception error)
    {
        var known = error as GuardError; if (known != null) return known.Code;
        var native = error as Win32Exception;
        if (native != null)
        {
            if (native.NativeErrorCode == 80 || native.NativeErrorCode == 183) return "DESTINATION_EXISTS";
            if (native.NativeErrorCode == 5 || native.NativeErrorCode == 32 || native.NativeErrorCode == 33) return "FILE_BUSY";
            if (native.NativeErrorCode == 17) return "CROSS_VOLUME";
        }
        if (error is InvalidOperationException)
        {
            if (error.Message == "PROOF_MISMATCH" || error.Message == "FILE_CHANGED" || error.Message == "LINK_PROOF_CHANGED") return "PROOF_MISMATCH";
            if (error.Message == "CROSS_VOLUME") return "CROSS_VOLUME";
            return "UNSAFE_PATH";
        }
        if (error is ArgumentException || error is DecoderFallbackException) return "INVALID_REQUEST";
        return "IO_FAILED";
    }
    static int Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (Environment.OSVersion.Platform != PlatformID.Win32NT || IntPtr.Size != 8) throw new GuardError("UNSUPPORTED_PLATFORM");
            if (args.Length != 0) throw new GuardError("INVALID_REQUEST");
            var bytes = new byte[16385]; int length = 0;
            using (var input = Console.OpenStandardInput())
            {
                while (length < bytes.Length) { int count = input.Read(bytes, length, bytes.Length - length); if (count == 0) break; length += count; }
            }
            if (length == 0 || length > 16384) throw new GuardError("INVALID_REQUEST");
            Execute(Request.Parse(new RequestJson(new UTF8Encoding(false, true).GetString(bytes, 0, length)).Parse()));
            Console.WriteLine("{\"version\":1,\"ok\":true}"); return 0;
        }
        catch (Exception error) { try { Console.WriteLine("{\"version\":1,\"ok\":false,\"code\":\"" + Error(error) + "\"}"); } catch { } return 1; }
    }
}
