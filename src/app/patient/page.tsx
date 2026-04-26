"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, bookAppointment, getPatientOpenVisit, listDoctorsForBooking } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuthStore } from "@/stores/auth";
import { usePatientQueueStore } from "@/stores/patient-queue";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function visitStatusLabel(status: "waiting" | "active"): string {
  if (status === "active") return "With doctor (consultation in progress)";
  return "Waiting in queue";
}

export default function PatientPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, accessToken, logout } = useAuthStore();
  const booking = usePatientQueueStore((s) => s.booking);
  const setBooking = usePatientQueueStore((s) => s.setBooking);

  const [status, setStatus] = useState<string>("Disconnected");
  const [doctorId, setDoctorId] = useState("");
  const [apptDate, setApptDate] = useState(todayLocalDate);
  const [apptTime, setApptTime] = useState("10:00");
  const [bookError, setBookError] = useState<string | null>(null);
  const [etaText, setEtaText] = useState<string | null>(null);

  const doctorsQuery = useQuery({
    queryKey: ["doctors", "booking"],
    queryFn: listDoctorsForBooking,
    enabled: Boolean(accessToken && user?.role === "patient"),
  });

  const openVisitQuery = useQuery({
    queryKey: ["patient", "openVisit"],
    queryFn: getPatientOpenVisit,
    enabled: Boolean(accessToken && user?.role === "patient"),
    refetchInterval: 20_000,
  });

  const openVisit = openVisitQuery.data ?? null;

  useEffect(() => {
    if (!openVisitQuery.isSuccess) return;
    if (openVisitQuery.data) {
      const v = openVisitQuery.data;
      setBooking({
        doctorId: v.doctorId,
        tokenId: v.tokenId,
        tokenNumber: v.tokenNumber,
        appointmentId: v.appointmentId,
        apptDate: v.apptDate,
        apptTime: v.apptTime,
      });
      return;
    }
    setBooking(null);
  }, [openVisitQuery.isSuccess, openVisitQuery.data, setBooking]);

  useEffect(() => {
    const list = doctorsQuery.data;
    if (!list?.length || doctorId) return;
    setDoctorId(list[0].id);
  }, [doctorId, doctorsQuery.data]);

  const socket = useMemo(() => getSocket(), []);

  useEffect(() => {
    if (!accessToken || !user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "patient") {
      router.replace("/doctor");
      return;
    }

    socket.connect();

    const doctorRoomId = openVisit?.doctorId ?? booking?.doctorId;

    function onConnect() {
      setStatus("Connected");
      if (user) {
        socket.emit("patient:register_location", { patientId: user.id });
      }
      if (doctorRoomId) {
        socket.emit("doctor:start_token", { doctorId: doctorRoomId });
      }
    }

    function onDisconnect() {
      setStatus("Disconnected");
    }

    function onEta(payload: Record<string, unknown>) {
      setEtaText(JSON.stringify(payload));
    }

    function invalidateOpenVisit() {
      void queryClient.invalidateQueries({ queryKey: ["patient", "openVisit"] });
    }

    function onYourTurn() {
      setEtaText("Your turn — please head to the doctor.");
      invalidateOpenVisit();
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("queue:eta_update", onEta);
    socket.on("queue:your_turn", onYourTurn);
    socket.on("queue:token_started", invalidateOpenVisit);
    socket.on("queue:token_ended", invalidateOpenVisit);
    socket.on("queue:token_skipped", invalidateOpenVisit);
    socket.on("queue:token_booked", invalidateOpenVisit);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("queue:eta_update", onEta);
      socket.off("queue:your_turn", onYourTurn);
      socket.off("queue:token_started", invalidateOpenVisit);
      socket.off("queue:token_ended", invalidateOpenVisit);
      socket.off("queue:token_skipped", invalidateOpenVisit);
      socket.off("queue:token_booked", invalidateOpenVisit);
    };
  }, [accessToken, booking?.doctorId, openVisit?.doctorId, queryClient, router, socket, user]);

  const bookMutation = useMutation({
    mutationFn: bookAppointment,
    onSuccess: (data) => {
      setBookError(null);
      setBooking({
        doctorId: data.doctorId,
        tokenId: data.tokenId,
        tokenNumber: data.tokenNumber,
        appointmentId: data.appointmentId,
        apptDate: data.apptDate,
        apptTime: data.apptTime,
      });
      if (user) {
        socket.emit("doctor:start_token", { doctorId: data.doctorId });
        socket.emit("patient:register_location", { patientId: user.id });
      }
      setEtaText("Booked. ETA updates will appear here when the queue moves.");
      void queryClient.invalidateQueries({ queryKey: ["patient", "openVisit"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const d = err.details as { message?: string | string[] } | undefined;
        const msg = Array.isArray(d?.message)
          ? d.message.join(", ")
          : typeof d?.message === "string"
            ? d.message
            : err.message;
        setBookError(msg);
        return;
      }
      setBookError(err instanceof Error ? err.message : "Booking failed");
    },
  });

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-sm font-semibold">Patient</div>
            <div className="text-xs text-zinc-500">{status}</div>
          </div>
          <Button
            className="bg-zinc-100 text-zinc-900 active:bg-zinc-200"
            onClick={() => {
              setBooking(null);
              logout();
              router.replace("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        {openVisitQuery.isPending ? (
          <Card>
            <div className="text-sm font-semibold">Your visit</div>
            <p className="mt-1 text-sm text-zinc-600">Checking your queue status…</p>
          </Card>
        ) : openVisit ? (
          <Card>
            <div className="text-sm font-semibold">Current visit</div>
            <p className="mt-1 text-xs text-zinc-600">
              Booking is hidden until this visit finishes (completed or skipped by the clinic).
            </p>
            <div className="mt-3 space-y-2 text-sm text-zinc-800">
              <div>
                Token <span className="font-semibold">#{openVisit.tokenNumber}</span>
                <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  {visitStatusLabel(openVisit.status)}
                </span>
              </div>
              <div className="text-xs text-zinc-500">
                Appointment {openVisit.apptDate} at {openVisit.apptTime}
              </div>
              <div className="text-xs text-zinc-400 break-all">Token ID: {openVisit.tokenId}</div>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="text-sm font-semibold">Book appointment</div>
            <p className="mt-1 text-xs text-zinc-600">
              Choose a doctor, then book. The app calls{" "}
              <code className="rounded bg-zinc-100 px-1">POST /api/queue/book</code> with your JWT.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <label className="text-xs font-medium text-zinc-800">
                Doctor
                <div className="mt-1">
                  {doctorsQuery.isLoading ? (
                    <div className="text-xs text-zinc-500">Loading doctors…</div>
                  ) : doctorsQuery.isError ? (
                    <div className="text-xs text-red-600">
                      Could not load doctors. Check you are logged in as a patient.
                    </div>
                  ) : !doctorsQuery.data?.length ? (
                    <div className="text-xs text-zinc-500">No active doctors yet.</div>
                  ) : (
                    <select
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                      value={doctorId}
                      onChange={(e) => setDoctorId(e.target.value)}
                    >
                      {doctorsQuery.data.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.speciality ? ` — ${d.speciality}` : ""}
                          {d.clinicName ? ` @ ${d.clinicName}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-zinc-800">
                  Date
                  <div className="mt-1">
                    <Input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
                  </div>
                </label>
                <label className="text-xs font-medium text-zinc-800">
                  Time (HH:MM)
                  <div className="mt-1">
                    <Input
                      placeholder="10:30"
                      value={apptTime}
                      onChange={(e) => setApptTime(e.target.value)}
                    />
                  </div>
                </label>
              </div>
              {bookError ? (
                <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{bookError}</div>
              ) : null}
              <Button
                type="button"
                disabled={
                  bookMutation.isPending ||
                  !doctorId ||
                  !apptDate ||
                  !/^\d{2}:\d{2}$/.test(apptTime)
                }
                onClick={() =>
                  bookMutation.mutate({ doctorId, apptDate, apptTime: apptTime.trim() })
                }
              >
                {bookMutation.isPending ? "Booking…" : "Book & get token"}
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <div className="text-sm font-semibold">Live ETA</div>
          <p className="mt-1 text-xs text-zinc-600">
            Updates arrive on <code className="rounded bg-zinc-100 px-1">queue:eta_update</code> after
            you share location (next step) or when the queue changes.
          </p>
          {etaText ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-zinc-100 p-2 text-xs">{etaText}</pre>
          ) : null}
        </Card>
      </main>
    </div>
  );
}
