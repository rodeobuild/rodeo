#!/usr/bin/env python3
"""Total memory of an app across all of its processes, the way Activity Monitor groups them.

usage: mem.py <root-pid> [--json] [--list]

A process belongs to the app when it is the root, a descendant of it, or macOS names the root (or
one of its descendants) as the process responsible for it. The last rule is what catches WKWebView's
WebContent, GPU and Networking processes, which launchd starts, so they are not children of the app.

The figure is phys_footprint (proc_pid_rusage, RUSAGE_INFO_V4): Activity Monitor's "Memory" column.
It counts compressed and GPU-owned memory and does not double count shared pages the way RSS does.
"""
import ctypes
import ctypes.util
import json
import subprocess
import sys

libc = ctypes.CDLL(None, use_errno=True)
libproc = ctypes.CDLL(ctypes.util.find_library("proc"))


class RUsageV4(ctypes.Structure):
    _fields_ = [
        ("ri_uuid", ctypes.c_uint8 * 16),
        ("ri_user_time", ctypes.c_uint64),
        ("ri_system_time", ctypes.c_uint64),
        ("ri_pkg_idle_wkups", ctypes.c_uint64),
        ("ri_interrupt_wkups", ctypes.c_uint64),
        ("ri_pageins", ctypes.c_uint64),
        ("ri_wired_size", ctypes.c_uint64),
        ("ri_resident_size", ctypes.c_uint64),
        ("ri_phys_footprint", ctypes.c_uint64),
        ("ri_proc_start_abstime", ctypes.c_uint64),
        ("ri_proc_exit_abstime", ctypes.c_uint64),
        ("ri_child_user_time", ctypes.c_uint64),
        ("ri_child_system_time", ctypes.c_uint64),
        ("ri_child_pkg_idle_wkups", ctypes.c_uint64),
        ("ri_child_interrupt_wkups", ctypes.c_uint64),
        ("ri_child_pageins", ctypes.c_uint64),
        ("ri_child_elapsed_abstime", ctypes.c_uint64),
        ("ri_diskio_bytesread", ctypes.c_uint64),
        ("ri_diskio_byteswritten", ctypes.c_uint64),
        ("ri_cpu_time_qos_default", ctypes.c_uint64),
        ("ri_cpu_time_qos_maintenance", ctypes.c_uint64),
        ("ri_cpu_time_qos_background", ctypes.c_uint64),
        ("ri_cpu_time_qos_utility", ctypes.c_uint64),
        ("ri_cpu_time_qos_legacy", ctypes.c_uint64),
        ("ri_cpu_time_qos_user_initiated", ctypes.c_uint64),
        ("ri_cpu_time_qos_user_interactive", ctypes.c_uint64),
        ("ri_billed_system_time", ctypes.c_uint64),
        ("ri_serviced_system_time", ctypes.c_uint64),
        ("ri_logical_writes", ctypes.c_uint64),
        ("ri_lifetime_max_phys_footprint", ctypes.c_uint64),
        ("ri_instructions", ctypes.c_uint64),
        ("ri_cycles", ctypes.c_uint64),
        ("ri_billed_energy", ctypes.c_uint64),
        ("ri_serviced_energy", ctypes.c_uint64),
        ("ri_interval_max_phys_footprint", ctypes.c_uint64),
        ("ri_runnable_time", ctypes.c_uint64),
    ]


def rusage(pid):
    info = RUsageV4()
    if libproc.proc_pid_rusage(pid, 4, ctypes.byref(info)) != 0:
        return None
    return info


def responsible(pid):
    try:
        fn = libc.responsibility_get_pid_responsible_for_pid
    except AttributeError:
        return -1
    fn.restype = ctypes.c_int
    fn.argtypes = [ctypes.c_int]
    return fn(pid)


def processes():
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,comm="], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            rows.append((int(parts[0]), int(parts[1]), parts[2]))
    return rows


def family(root):
    rows = processes()
    members = {root}
    grew = True
    while grew:
        grew = False
        for pid, ppid, _ in rows:
            if pid in members:
                continue
            if ppid in members or responsible(pid) in members:
                members.add(pid)
                grew = True
    return [(pid, comm) for pid, _, comm in rows if pid in members]


def measure(root):
    procs = []
    total = 0
    peak = 0
    for pid, comm in family(root):
        info = rusage(pid)
        if info is None:
            continue
        name = comm.rsplit("/", 1)[-1]
        procs.append({"pid": pid, "name": name, "mb": round(info.ri_phys_footprint / 1048576, 1), "peak_mb": round(info.ri_lifetime_max_phys_footprint / 1048576, 1)})
        total += info.ri_phys_footprint
        peak += info.ri_lifetime_max_phys_footprint
    procs.sort(key=lambda p: -p["mb"])
    return {"total_mb": round(total / 1048576, 1), "sum_of_peaks_mb": round(peak / 1048576, 1), "count": len(procs), "processes": procs}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    result = measure(int(args[0]))
    if "--json" in sys.argv:
        print(json.dumps(result))
    else:
        print(f"{result['total_mb']} MB in {result['count']} processes")
        if "--list" in sys.argv:
            for p in result["processes"]:
                print(f"  {p['mb']:>9} MB  {p['pid']:>6}  {p['name']}")
