using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace WarbandOutfitStudio
{
    /// <summary>
    /// Root launcher. Starts the local server in a Windows Job Object with
    /// KILL_ON_JOB_CLOSE, so closing this console (or exiting the launcher)
    /// terminates the Node server and any process it owns in the job.
    /// </summary>
    internal static class Launcher
    {
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr job,
            int infoClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info,
            uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private static int Main(string[] args)
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string entry = Path.Combine(root, "backend", "server", "index.js");
            if (!File.Exists(entry))
            {
                Console.Error.WriteLine("No se encontró backend\\server\\index.js junto al ejecutable.");
                Pause();
                return 1;
            }

            string bundledNode = Path.Combine(root, "runtime", "node.exe");
            string node = File.Exists(bundledNode) ? bundledNode : "node";
            Console.Title = "WARBand Outfit Studio";
            Console.WriteLine();
            Console.WriteLine("  Iniciando WARBand Outfit Studio...");
            Console.WriteLine("  Cierra esta ventana para detener el servidor.");
            Console.WriteLine();

            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job != IntPtr.Zero)
            {
                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    ref info,
                    (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
            }

            try
            {
                var start = new ProcessStartInfo
                {
                    FileName = node,
                    Arguments = "backend\\server\\index.js --open",
                    WorkingDirectory = root,
                    UseShellExecute = false,
                };
                using (Process child = Process.Start(start))
                {
                    if (child == null)
                    {
                        Console.Error.WriteLine("No se pudo iniciar Node.js.");
                        return 1;
                    }
                    if (job != IntPtr.Zero)
                    {
                        AssignProcessToJobObject(job, child.Handle);
                    }
                    child.WaitForExit();
                    if (child.ExitCode != 0) Pause();
                    return child.ExitCode;
                }
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("No se pudo iniciar el servidor: " + error.Message);
                Console.Error.WriteLine("Comprueba que Node.js 22+ esté instalado o incluye runtime\\node.exe.");
                Pause();
                return 1;
            }
            finally
            {
                if (job != IntPtr.Zero) CloseHandle(job);
            }
        }

        private static void Pause()
        {
            if (!Environment.UserInteractive) return;
            Console.WriteLine();
            Console.WriteLine("Pulsa una tecla para cerrar...");
            try { Console.ReadKey(true); } catch { }
        }
    }
}
