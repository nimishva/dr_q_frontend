"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getDoctorQueueToday,
  queueEndToken,
  queueSkipToken,
  queueStartToken,
  type QueueAppointment,
  type QueueTokenRow,
} from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuthStore } from "@/stores/auth";
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

  const queueQuery = useQuery({
    queryKey: ["doctor", "queue", "today"],
    queryFn: getDoctorQueueToday,
    enabled: Boolean(accessToken && user?.role === "doctor"),
    refetchInterval: 25_000,
  });

  const queue = queueQuery.data ?? null;

  const firstWaitingTokenId = useMemo(() => {
    if (!queue?.waiting.length) return null;
    const n = Math.min(...queue.waiting.map((t) => t.tokenNumber));
    return queue.waiting.find((t) => t.tokenNumber === n)?.id ?? null;
  }, [queue?.waiting]);

  const activeTokenId = queue?.active?.id ?? null;

  const invalidateQueue = () =>
    void queryClient.invalidateQueries({ queryKey: ["doctor", "queue", "today"] });

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

  const socket = useMemo(() => getSocket(), []);

  useEffect(() => {
    if (!accessToken || !user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "doctor") {
      router.replace("/patient");
      return;
    }

    socket.connect();

    const doctorId = queue?.doctorId;

    function onConnect() {
      setStatus("Connected");
      if (doctorId) {
        socket.emit("doctor:start_token", { doctorId });
      }
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

    if (socket.connected && doctorId) {
      socket.emit("doctor:start_token", { doctorId });
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("queue:token_started", onQueueEvent);
      socket.off("queue:token_ended", onQueueEvent);
      socket.off("queue:token_skipped", onQueueEvent);
      socket.off("queue:token_booked", onQueueEvent);
    };
  }, [accessToken, queue?.doctorId, queryClient, router, socket, user]);

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

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-sm font-semibold">Doctor dashboard</div>
            <div className="text-xs text-zinc-500">{status}</div>
          </div>
          <Button
            className="bg-zinc-100 text-zinc-900 active:bg-zinc-200"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        {queueQuery.isPending ? (
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
        )}
      </main>
    </div>
  );
}
