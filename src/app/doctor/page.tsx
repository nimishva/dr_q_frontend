"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  createMyClinicException,
  deleteMyClinicException,
  getDoctorQueueToday,
  listClinics,
  listMyClinicSchedules,
  listMyClinicExceptions,
  queueEndToken,
  queueSkipToken,
  queueStartToken,
  upsertMyClinicSchedule,
  deleteMyClinicSchedule,
  updateMyClinicException,
  type ClinicScheduleExceptionRow,
  type QueueAppointment,
  type QueueTokenRow,
} from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuthStore } from "@/stores/auth";
import { roleHomePath } from "@/lib/roleHome";
import { AppShellHeader } from "@/components/layout/AppShellHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

function appointmentLabel(a: QueueAppointment | null | undefined): string {
  if (!a) return "—";
  return `${a.apptDate} · ${a.apptTime}`;
}

function TokenActions({
  token,
  canStart,
  activeTokenId,
  onStart,
  onEnd,
  onSkip,
  busyId,
}: {
  token: QueueTokenRow;
  canStart: boolean;
  activeTokenId: string | null;
  onStart: (id: string) => void;
  onEnd: (id: string) => void;
  onSkip: (id: string) => void;
  busyId: string | null;
}) {
  const busy = busyId === token.id;
  if (token.status === "waiting") {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          className="flex-1 min-w-[7rem] py-2 text-xs"
          disabled={!canStart || busy}
          onClick={() => onStart(token.id)}
        >
          {busy ? "…" : "Start"}
        </Button>
        <Button
          type="button"
          className="flex-1 min-w-[7rem] bg-amber-100 py-2 text-xs text-amber-950 active:bg-amber-200"
          disabled={busy}
          onClick={() => onSkip(token.id)}
        >
          Skip
        </Button>
      </div>
    );
  }
  if (token.status === "active" && activeTokenId === token.id) {
    return (
      <div className="mt-2">
        <Button type="button" className="w-full py-2 text-xs" disabled={busy} onClick={() => onEnd(token.id)}>
          {busy ? "…" : "End consultation"}
        </Button>
      </div>
    );
  }
  return null;
}

export default function DoctorPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, accessToken, logout } = useAuthStore();
  const [status, setStatus] = useState<string>("Disconnected");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [tab, setTab] = useState<"today" | "schedule" | "exceptions">("today");

  const todayIso = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const [exFrom, setExFrom] = useState<string>(todayIso);
  const [exTo, setExTo] = useState<string>(todayIso);
  const [exForm, setExForm] = useState<{
    id?: string | null;
    scope: "clinic" | "doctor";
    date: string;
    type: "closed" | "open";
    fromTime: string;
    toTime: string;
    note: string;
    allDay: boolean;
  }>({
    id: null,
    scope: "doctor",
    date: todayIso,
    type: "closed",
    fromTime: "09:00",
    toTime: "17:00",
    note: "",
    allDay: true,
  });
  const [exceptionError, setExceptionError] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ["doctor", "queue", "today"],
    queryFn: getDoctorQueueToday,
    enabled: Boolean(accessToken && user?.role === "doctor"),
    refetchInterval: 25_000,
  });

  const clinicsQuery = useQuery({
    queryKey: ["clinics", "directory"],
    queryFn: listClinics,
    enabled: Boolean(accessToken && user?.role === "doctor"),
    staleTime: 60_000,
  });

  const schedulesQuery = useQuery({
    queryKey: ["doctor", "me", "clinicSchedules"],
    queryFn: listMyClinicSchedules,
    enabled: Boolean(accessToken && user?.role === "doctor"),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const effectiveClinicId = selectedClinicId || clinicsQuery.data?.[0]?.id || "";

  const exceptionsQuery = useQuery({
    queryKey: ["doctor", "me", "clinicExceptions", effectiveClinicId, exFrom, exTo],
    queryFn: () => listMyClinicExceptions({ clinicId: effectiveClinicId, from: exFrom, to: exTo }),
    enabled: Boolean(accessToken && user?.role === "doctor" && effectiveClinicId && exFrom && exTo),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const [days, setDays] = useState<Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">>([
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
  ]);
  const [fromTime, setFromTime] = useState("09:00");
  const [toTime, setToTime] = useState("17:00");

  const queue = queueQuery.data ?? null;

  const firstWaitingTokenId = (() => {
    if (!queue?.waiting.length) return null;
    const n = Math.min(...queue.waiting.map((t) => t.tokenNumber));
    return queue.waiting.find((t) => t.tokenNumber === n)?.id ?? null;
  })();

  const activeTokenId = queue?.active?.id ?? null;

  const invalidateQueue = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["doctor", "queue", "today"] });
  }, [queryClient]);

  const startMut = useMutation({
    mutationFn: queueStartToken,
    onMutate: (tokenId: string) => setBusyTokenId(tokenId),
    onSettled: () => {
      setBusyTokenId(null);
      invalidateQueue();
    },
    onError: (e: unknown) =>
      setActionError(e instanceof ApiError ? e.message : "Start failed"),
  });

  const endMut = useMutation({
    mutationFn: queueEndToken,
    onMutate: (tokenId: string) => setBusyTokenId(tokenId),
    onSettled: () => {
      setBusyTokenId(null);
      invalidateQueue();
    },
    onError: (e: unknown) =>
      setActionError(e instanceof ApiError ? e.message : "End failed"),
  });

  const skipMut = useMutation({
    mutationFn: queueSkipToken,
    onMutate: (tokenId: string) => setBusyTokenId(tokenId),
    onSettled: () => {
      setBusyTokenId(null);
      invalidateQueue();
    },
    onError: (e: unknown) =>
      setActionError(e instanceof ApiError ? e.message : "Skip failed"),
  });

  const saveScheduleMut = useMutation({
    mutationFn: upsertMyClinicSchedule,
    onSuccess: () => {
      setAvailabilityError(null);
      void queryClient.invalidateQueries({ queryKey: ["doctor", "me", "clinicSchedules"] });
    },
    onError: (e: unknown) =>
      setAvailabilityError(e instanceof ApiError ? e.message : "Save failed"),
  });

  const deleteScheduleMut = useMutation({
    mutationFn: deleteMyClinicSchedule,
    onSuccess: () => {
      setAvailabilityError(null);
      void queryClient.invalidateQueries({ queryKey: ["doctor", "me", "clinicSchedules"] });
    },
    onError: (e: unknown) =>
      setAvailabilityError(e instanceof ApiError ? e.message : "Delete failed"),
  });

  const createExceptionMut = useMutation({
    mutationFn: createMyClinicException,
    onSuccess: () => {
      setExceptionError(null);
      void queryClient.invalidateQueries({
        queryKey: ["doctor", "me", "clinicExceptions", effectiveClinicId, exFrom, exTo],
      });
      setExForm((p) => ({ ...p, id: null }));
    },
    onError: (e: unknown) =>
      setExceptionError(e instanceof ApiError ? e.message : "Create failed"),
  });

  const updateExceptionMut = useMutation({
    mutationFn: updateMyClinicException,
    onSuccess: () => {
      setExceptionError(null);
      void queryClient.invalidateQueries({
        queryKey: ["doctor", "me", "clinicExceptions", effectiveClinicId, exFrom, exTo],
      });
      setExForm((p) => ({ ...p, id: null }));
    },
    onError: (e: unknown) =>
      setExceptionError(e instanceof ApiError ? e.message : "Update failed"),
  });

  const deleteExceptionMut = useMutation({
    mutationFn: deleteMyClinicException,
    onSuccess: () => {
      setExceptionError(null);
      void queryClient.invalidateQueries({
        queryKey: ["doctor", "me", "clinicExceptions", effectiveClinicId, exFrom, exTo],
      });
    },
    onError: (e: unknown) =>
      setExceptionError(e instanceof ApiError ? e.message : "Delete failed"),
  });

  const socket = useMemo(() => getSocket(), []);

  useEffect(() => {
    if (!accessToken || !user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "doctor") {
      router.replace(roleHomePath(user.role));
      return;
    }

    socket.connect();

    function onConnect() {
      setStatus("Connected");
      socket.emit("doctor:join_room");
    }

    function onDisconnect() {
      setStatus("Disconnected");
    }

    function onQueueEvent() {
      invalidateQueue();
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("queue:token_started", onQueueEvent);
    socket.on("queue:token_ended", onQueueEvent);
    socket.on("queue:token_skipped", onQueueEvent);
    socket.on("queue:token_booked", onQueueEvent);

    if (socket.connected) socket.emit("doctor:join_room");

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("queue:token_started", onQueueEvent);
      socket.off("queue:token_ended", onQueueEvent);
      socket.off("queue:token_skipped", onQueueEvent);
      socket.off("queue:token_booked", onQueueEvent);
    };
  }, [accessToken, invalidateQueue, router, socket, user]);

  function renderTokenCard(t: QueueTokenRow, opts: { canStart: boolean }) {
    const p = t.patient;
    return (
      <div
        key={t.id}
        className={`rounded-xl border p-3 ${
          t.status === "active" ? "border-emerald-200 bg-emerald-50/60" : "border-zinc-100 bg-zinc-50/80"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-zinc-900">Token #{t.tokenNumber}</div>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium uppercase text-zinc-600">
            {t.status}
          </span>
        </div>
        <div className="mt-2 text-sm text-zinc-800">{p?.name ?? "Patient"}</div>
        {p?.phone ? <div className="text-xs text-zinc-500">{p.phone}</div> : null}
        <div className="mt-2 text-xs text-zinc-600">
          <span className="font-medium text-zinc-700">Appointment:</span>{" "}
          {appointmentLabel(t.appointment ?? undefined)}
          {t.appointment ? (
            <span className="ml-1 text-zinc-400">({t.appointment.status})</span>
          ) : null}
        </div>
        <TokenActions
          token={t}
          canStart={opts.canStart && !activeTokenId}
          activeTokenId={activeTokenId}
          onStart={(id) => {
            setActionError(null);
            startMut.mutate(id);
          }}
          onEnd={(id) => {
            setActionError(null);
            endMut.mutate(id);
          }}
          onSkip={(id) => {
            setActionError(null);
            skipMut.mutate(id);
          }}
          busyId={busyTokenId}
        />
      </div>
    );
  }

  const connected = status === "Connected";

  const exceptions = (exceptionsQuery.data ?? []) as ClinicScheduleExceptionRow[];

  return (
    <div className="flex flex-1 flex-col bg-zinc-100">
      <AppShellHeader
        displayName={user?.name ?? "Doctor"}
        roleBadge="Doctor"
        liveConnected={connected}
        onSignOut={() => {
          logout();
          router.replace("/login");
        }}
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-bold text-zinc-900">Doctor dashboard</div>
              <p className="mt-1 text-sm text-zinc-600">
                Quick access to today’s queue, clinic schedules, and exception overrides.
              </p>
            </div>
            <div className="text-xs font-semibold text-zinc-600">
              {effectiveClinicId ? "Clinic selected" : "No clinic"}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ["today", "Today"],
                ["schedule", "Schedules"],
                ["exceptions", "Exceptions"],
              ] as const
            ).map(([id, label]) => {
              const on = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    on ? "bg-zinc-900 text-white" : "bg-white text-zinc-800 border border-zinc-200 hover:bg-zinc-50"
                  }`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Card>

        {tab === "schedule" ? (
          <Card>
            <div className="text-base font-bold text-zinc-900">Consultation schedule</div>
            <p className="mt-1 text-sm text-zinc-600">
              A doctor can consult in multiple clinics. Your schedules must not overlap across clinics.
            </p>

            {clinicsQuery.isLoading ? (
              <div className="mt-3 text-sm text-zinc-600">Loading clinics…</div>
            ) : clinicsQuery.isError ? (
              <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Could not load clinics.</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-700">Clinic</div>
                  <div className="mt-2">
                    <select
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                      value={effectiveClinicId}
                      onChange={(e) => setSelectedClinicId(e.target.value)}
                    >
                      {(clinicsQuery.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-700">Days</div>
                  <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {(
                      [
                        ["mon", "Mon"],
                        ["tue", "Tue"],
                        ["wed", "Wed"],
                        ["thu", "Thu"],
                        ["fri", "Fri"],
                        ["sat", "Sat"],
                        ["sun", "Sun"],
                      ] as const
                    ).map(([id, label]) => {
                      const on = days.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                            on
                              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                              : "border-zinc-200 bg-white text-zinc-700"
                          }`}
                          onClick={() => {
                            setAvailabilityError(null);
                            setDays((prev) => {
                              if (prev.includes(id)) return prev.filter((d) => d !== id);
                              return [...prev, id];
                            });
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">Pick at least one day.</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-zinc-800">
                    From
                    <div className="mt-1">
                      <input
                        type="time"
                        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                        value={fromTime}
                        onChange={(e) => setFromTime(e.target.value)}
                      />
                    </div>
                  </label>
                  <label className="text-xs font-medium text-zinc-800">
                    To
                    <div className="mt-1">
                      <input
                        type="time"
                        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                        value={toTime}
                        onChange={(e) => setToTime(e.target.value)}
                      />
                    </div>
                  </label>
                </div>

                {availabilityError ? (
                  <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{availabilityError}</div>
                ) : null}

                <Button
                  type="button"
                  disabled={
                    saveScheduleMut.isPending ||
                    !effectiveClinicId ||
                    days.length === 0 ||
                    !/^\d{2}:\d{2}$/.test(fromTime) ||
                    !/^\d{2}:\d{2}$/.test(toTime)
                  }
                  onClick={() => {
                    setAvailabilityError(null);
                    saveScheduleMut.mutate({
                      clinicId: effectiveClinicId,
                      availableDays: days,
                      availableFrom: fromTime,
                      availableTo: toTime,
                    });
                  }}
                >
                  {saveScheduleMut.isPending ? "Saving…" : "Save schedule"}
                </Button>

                <div className="pt-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-700">
                    Your clinic schedules
                  </div>
                  {schedulesQuery.isLoading ? (
                    <div className="mt-2 text-sm text-zinc-600">Loading schedules…</div>
                  ) : schedulesQuery.isError ? (
                    <div className="mt-2 text-sm text-red-700">Could not load schedules.</div>
                  ) : !(schedulesQuery.data?.length) ? (
                    <div className="mt-2 text-sm text-zinc-600">No schedules yet.</div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {schedulesQuery.data.map((s) => (
                        <div key={s.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-zinc-900">{s.clinicName}</div>
                              <div className="mt-1 text-xs text-zinc-600">
                                {s.availableDays.join(", ")} · {s.availableFrom}–{s.availableTo}
                              </div>
                            </div>
                            <button
                              type="button"
                              aria-label="Remove schedule"
                              title="Remove schedule"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 active:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={deleteScheduleMut.isPending}
                              onClick={() => deleteScheduleMut.mutate(s.clinicId)}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M6 6l1 16h10l1-16" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        ) : null}

        {tab === "exceptions" ? (
          <Card>
            <div className="text-base font-bold text-zinc-900">Exceptions</div>
            <p className="mt-1 text-sm text-zinc-600">
              Close the clinic, mark doctor leave, or add a special open session for a specific date.
            </p>

            {clinicsQuery.isLoading ? (
              <div className="mt-3 text-sm text-zinc-600">Loading clinics…</div>
            ) : clinicsQuery.isError ? (
              <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Could not load clinics.</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-700">Clinic</div>
                  <div className="mt-2">
                    <select
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                      value={effectiveClinicId}
                      onChange={(e) => setSelectedClinicId(e.target.value)}
                    >
                      {(clinicsQuery.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-zinc-800">
                    From
                    <div className="mt-1">
                      <input
                        type="date"
                        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                        value={exFrom}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExFrom(v);
                          setExceptionError(null);
                          setExForm((p) => (p.id ? p : { ...p, date: v }));
                        }}
                      />
                    </div>
                  </label>
                  <label className="text-xs font-medium text-zinc-800">
                    To
                    <div className="mt-1">
                      <input
                        type="date"
                        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                        value={exTo}
                        onChange={(e) => {
                          setExTo(e.target.value);
                          setExceptionError(null);
                        }}
                      />
                    </div>
                  </label>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-3">
                  <div className="text-sm font-semibold text-zinc-900">
                    {exForm.id ? "Edit exception" : "Add exception"}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-zinc-800">
                      Scope
                      <div className="mt-1">
                        <select
                          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                          value={exForm.scope}
                          onChange={(e) =>
                            setExForm((p) => ({ ...p, scope: e.target.value as "clinic" | "doctor" }))
                          }
                        >
                          <option value="doctor">Doctor leave (only me)</option>
                          <option value="clinic">Clinic-wide</option>
                        </select>
                      </div>
                    </label>
                    <label className="text-xs font-medium text-zinc-800">
                      Type
                      <div className="mt-1">
                        <select
                          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                          value={exForm.type}
                          onChange={(e) =>
                            setExForm((p) => ({ ...p, type: e.target.value as "closed" | "open" }))
                          }
                        >
                          <option value="closed">Closed (block slots)</option>
                          <option value="open">Open (special session)</option>
                        </select>
                      </div>
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-zinc-800">
                      Date
                      <div className="mt-1">
                        <input
                          type="date"
                          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                          value={exForm.date}
                          onChange={(e) => setExForm((p) => ({ ...p, date: e.target.value }))}
                        />
                      </div>
                    </label>
                    <label className="flex items-end gap-2 text-xs font-medium text-zinc-800">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-zinc-900"
                        checked={exForm.allDay}
                        onChange={(e) => setExForm((p) => ({ ...p, allDay: e.target.checked }))}
                      />
                      All day
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-zinc-800">
                      From time
                      <div className="mt-1">
                        <input
                          type="time"
                          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15 disabled:bg-zinc-50"
                          value={exForm.fromTime}
                          disabled={exForm.allDay}
                          onChange={(e) => setExForm((p) => ({ ...p, fromTime: e.target.value }))}
                        />
                      </div>
                    </label>
                    <label className="text-xs font-medium text-zinc-800">
                      To time
                      <div className="mt-1">
                        <input
                          type="time"
                          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15 disabled:bg-zinc-50"
                          value={exForm.toTime}
                          disabled={exForm.allDay}
                          onChange={(e) => setExForm((p) => ({ ...p, toTime: e.target.value }))}
                        />
                      </div>
                    </label>
                  </div>

                  <label className="mt-3 block text-xs font-medium text-zinc-800">
                    Note (optional)
                    <div className="mt-1">
                      <input
                        type="text"
                        placeholder="e.g. Public holiday / conference / extra evening session"
                        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                        value={exForm.note}
                        onChange={(e) => setExForm((p) => ({ ...p, note: e.target.value }))}
                      />
                    </div>
                  </label>

                  {exceptionError ? (
                    <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                      {exceptionError}
                    </div>
                  ) : null}

                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      disabled={
                        !effectiveClinicId ||
                        !/^\d{4}-\d{2}-\d{2}$/.test(exForm.date) ||
                        (!exForm.allDay &&
                          (!/^\d{2}:\d{2}$/.test(exForm.fromTime) || !/^\d{2}:\d{2}$/.test(exForm.toTime))) ||
                        createExceptionMut.isPending ||
                        updateExceptionMut.isPending
                      }
                      onClick={() => {
                        setExceptionError(null);
                        if (!exForm.allDay && exForm.fromTime >= exForm.toTime) {
                          setExceptionError("From time must be before to time.");
                          return;
                        }
                        const payload = {
                          clinicId: effectiveClinicId,
                          scope: exForm.scope,
                          date: exForm.date,
                          type: exForm.type,
                          fromTime: exForm.allDay ? null : exForm.fromTime,
                          toTime: exForm.allDay ? null : exForm.toTime,
                          note: exForm.note || null,
                        } as const;
                        if (exForm.id) {
                          updateExceptionMut.mutate({ id: exForm.id, ...payload });
                        } else {
                          createExceptionMut.mutate(payload);
                        }
                      }}
                    >
                      {createExceptionMut.isPending || updateExceptionMut.isPending
                        ? "Saving…"
                        : exForm.id
                          ? "Save changes"
                          : "Add exception"}
                    </Button>
                    {exForm.id ? (
                      <Button
                        type="button"
                        className="bg-zinc-100 text-zinc-900 active:bg-zinc-200"
                        onClick={() => setExForm((p) => ({ ...p, id: null }))}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div>
                  {exceptionsQuery.isLoading ? (
                    <div className="text-sm text-zinc-600">Loading exceptions…</div>
                  ) : exceptionsQuery.isError ? (
                    <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                      Could not load exceptions.
                    </div>
                  ) : !exceptions.length ? (
                    <div className="text-sm text-zinc-600">No exceptions in this range.</div>
                  ) : (
                    <div className="space-y-2">
                      {exceptions.map((ex) => {
                        const labelScope = ex.doctorId ? "Doctor" : "Clinic";
                        const labelTime = ex.fromTime && ex.toTime ? `${ex.fromTime}–${ex.toTime}` : "All day";
                        return (
                          <div key={ex.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-zinc-900">{ex.date}</span>
                                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                                    {labelScope}
                                  </span>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                      ex.type === "closed"
                                        ? "bg-red-50 text-red-700"
                                        : "bg-emerald-50 text-emerald-700"
                                    }`}
                                  >
                                    {ex.type}
                                  </span>
                                  <span className="text-xs text-zinc-600">{labelTime}</span>
                                </div>
                                {ex.note ? (
                                  <div className="mt-1 truncate text-xs text-zinc-500">{ex.note}</div>
                                ) : null}
                              </div>

                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  className="bg-zinc-100 text-zinc-900 active:bg-zinc-200"
                                  onClick={() => {
                                    setExceptionError(null);
                                    setExForm({
                                      id: ex.id,
                                      scope: ex.doctorId ? "doctor" : "clinic",
                                      date: ex.date,
                                      type: ex.type,
                                      fromTime: ex.fromTime ?? "09:00",
                                      toTime: ex.toTime ?? "17:00",
                                      note: ex.note ?? "",
                                      allDay: !(ex.fromTime && ex.toTime),
                                    });
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  className="bg-rose-50 text-rose-800 active:bg-rose-100"
                                  disabled={deleteExceptionMut.isPending}
                                  onClick={() => {
                                    setExceptionError(null);
                                    deleteExceptionMut.mutate({ id: ex.id, clinicId: effectiveClinicId });
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        ) : null}

        {tab === "today" ? (
          queueQuery.isPending ? (
            <Card>
              <p className="text-sm text-zinc-600">Loading today’s queue…</p>
            </Card>
          ) : queueQuery.isError ? (
            <Card>
              <div className="text-sm font-semibold text-red-800">Could not load queue</div>
              <p className="mt-1 text-xs text-zinc-600">
                {queueQuery.error instanceof ApiError && queueQuery.error.status === 404
                  ? "This login is not linked to a doctor profile. Register with role doctor and a valid clinicId, or use the correct account."
                  : queueQuery.error instanceof Error
                    ? queueQuery.error.message
                    : "Unknown error"}
              </p>
            </Card>
          ) : (
            <>
              {actionError ? (
                <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</div>
              ) : null}

              <Card>
                <div className="text-sm font-semibold">Now serving</div>
                {queue?.active ? (
                  <div className="mt-2">{renderTokenCard(queue.active, { canStart: false })}</div>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600">No active consultation.</p>
                )}
              </Card>

              <Card>
                <div className="text-sm font-semibold">Waiting ({queue?.waiting.length ?? 0})</div>
                <p className="mt-1 text-xs text-zinc-500">
                  Appointment date and time come from each booking. Only the next token can be started
                  when nobody is active.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {queue?.waiting.length ? (
                    queue.waiting.map((t) =>
                      renderTokenCard(t, { canStart: t.id === firstWaitingTokenId }),
                    )
                  ) : (
                    <p className="text-sm text-zinc-600">No patients waiting.</p>
                  )}
                </div>
              </Card>

              <Card>
                <div className="text-sm font-semibold">Completed today ({queue?.completed.length ?? 0})</div>
                <div className="mt-2 flex flex-col gap-2">
                  {queue?.completed.length ? (
                    queue.completed.map((t) => (
                      <div key={t.id} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs">
                        <span className="font-semibold">#{t.tokenNumber}</span>{" "}
                        <span className="text-zinc-700">{t.patient?.name ?? "Patient"}</span>
                        <span className="text-zinc-400"> · {appointmentLabel(t.appointment ?? undefined)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-600">None yet.</p>
                  )}
                </div>
              </Card>

              <Card>
                <div className="text-sm font-semibold">Skipped today ({queue?.skipped.length ?? 0})</div>
                <div className="mt-2 flex flex-col gap-2">
                  {queue?.skipped.length ? (
                    queue.skipped.map((t) => (
                      <div key={t.id} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs">
                        <span className="font-semibold">#{t.tokenNumber}</span>{" "}
                        <span className="text-zinc-700">{t.patient?.name ?? "Patient"}</span>
                        <span className="text-zinc-400"> · {appointmentLabel(t.appointment ?? undefined)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-600">None.</p>
                  )}
                </div>
              </Card>
            </>
          )
        ) : null}
      </main>
    </div>
  );
}
