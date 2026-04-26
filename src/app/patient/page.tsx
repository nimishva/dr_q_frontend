"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  bookAppointment,
  getClinicDoctorAvailability,
  getPatientOpenVisit,
  listClinicDoctorsForDate,
  listClinics,
} from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuthStore } from "@/stores/auth";
import { usePatientQueueStore } from "@/stores/patient-queue";
import { roleHomePath } from "@/lib/roleHome";
import { AppShellHeader } from "@/components/layout/AppShellHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

function visitStatusLabel(status: "waiting" | "active"): string {
  if (status === "active") return "With doctor (consultation in progress)";
  return "Waiting in queue";
}

function formatAmPm(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  const am = h < 12;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

function buildTimeOptions(stepMin = 15): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMin) {
    const hh = Math.floor(minutes / 60);
    const mm = minutes % 60;
    const value = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    out.push({ value, label: formatAmPm(value) });
  }
  return out;
}

type EtaMetrics = {
  tokensAhead: number;
  travelTimeMin: number;
  waitAtClinicMin: number;
  leaveHomeInMin: number;
  shouldLeaveNow: boolean;
  avgConsultMin?: number;
};

function formatApptTimeDisplay(isoDate: string, hhmm: string): string {
  return `${isoDate} · ${formatAmPm(hhmm)}`;
}

function toHHMM(params: { hour12: number; minute: number; ampm: "AM" | "PM" }): string {
  const h = params.hour12 % 12;
  const hour24 = params.ampm === "PM" ? h + 12 : h;
  return `${String(hour24).padStart(2, "0")}:${String(params.minute).padStart(2, "0")}`;
}

function parseHHMMToPicker(hhmm: string): { hour12: number; minute: number; ampm: "AM" | "PM" } {
  const [hRaw, mRaw] = hhmm.split(":");
  const h24 = Number(hRaw);
  const minute = Number(mRaw);
  const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const hour12 = ((h24 + 11) % 12) + 1;
  return { hour12, minute, ampm };
}

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameLocalDate(a: string, b: Date): boolean {
  const y = b.getFullYear();
  const m = String(b.getMonth() + 1).padStart(2, "0");
  const d = String(b.getDate()).padStart(2, "0");
  return a === `${y}-${m}-${d}`;
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export default function PatientPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, accessToken, logout } = useAuthStore();
  const booking = usePatientQueueStore((s) => s.booking);
  const setBooking = usePatientQueueStore((s) => s.setBooking);

  const [status, setStatus] = useState<string>("Disconnected");
  const [clinicId, setClinicId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [apptDate, setApptDate] = useState(todayLocalDate);
  const timeOptions = useMemo(() => buildTimeOptions(15), []);
  const initialPicker = useMemo(() => parseHHMMToPicker(timeOptions[40]?.value ?? "10:00"), [timeOptions]);
  const [apptHour, setApptHour] = useState<number>(initialPicker.hour12);
  const [apptMinute, setApptMinute] = useState<number>(initialPicker.minute);
  const [apptAmPm, setApptAmPm] = useState<"AM" | "PM">(initialPicker.ampm);
  const [bookError, setBookError] = useState<string | null>(null);
  /** Plain-language line under the headline (booked, your turn, status). */
  const [etaBanner, setEtaBanner] = useState<string | null>(null);
  /** Structured ETA from `queue:eta_update` — drives the big metric tiles. */
  const [etaMetrics, setEtaMetrics] = useState<EtaMetrics | null>(null);
  const [geoStatus, setGeoStatus] = useState<string>("Location not started");

  const clinicsQuery = useQuery({
    queryKey: ["clinics", "directory"],
    queryFn: listClinics,
    enabled: Boolean(accessToken && user?.role === "patient"),
    staleTime: 60_000,
  });

  const doctorsQuery = useQuery({
    queryKey: ["clinics", clinicId, "doctorsForDate", apptDate],
    queryFn: () => listClinicDoctorsForDate({ clinicId, date: apptDate }),
    enabled: Boolean(accessToken && user?.role === "patient" && clinicId && apptDate),
    staleTime: 10_000,
  });

  const openVisitQuery = useQuery({
    queryKey: ["patient", "openVisit"],
    queryFn: getPatientOpenVisit,
    enabled: Boolean(accessToken && user?.role === "patient"),
    refetchInterval: 20_000,
  });

  const openVisit = openVisitQuery.data ?? null;

  const availabilityQuery = useQuery({
    queryKey: ["clinics", clinicId, "doctors", doctorId, "availability", apptDate],
    queryFn: () => getClinicDoctorAvailability({ clinicId, doctorId, date: apptDate }),
    enabled: Boolean(accessToken && user?.role === "patient" && clinicId && doctorId && apptDate),
    staleTime: 8_000,
    refetchInterval: 12_000,
  });

  const availability = availabilityQuery.data ?? null;

  const requestedTime = toHHMM({ hour12: apptHour, minute: apptMinute, ampm: apptAmPm });

  const disabledTimes = useMemo(() => {
    const disabled = new Set<string>(availability?.disabled ?? []);
    return disabled;
  }, [availability?.disabled]);

  const allowedTimes = useMemo(() => new Set<string>(availability?.slots ?? []), [availability?.slots]);

  const isBlocked = useMemo(() => {
    return (hour12: number, minute: number, ampm: "AM" | "PM") =>
      disabledTimes.has(toHHMM({ hour12, minute, ampm }));
  }, [disabledTimes]);

  const hourHasAnyAvailable = useMemo(() => {
    return (hour12: number, ampm: "AM" | "PM") =>
      [0, 15, 30, 45].some((m) => !disabledTimes.has(toHHMM({ hour12, minute: m, ampm })));
  }, [disabledTimes]);

  const ampmHasAnyAvailable = useMemo(() => {
    return (ampm: "AM" | "PM") =>
      Array.from({ length: 12 }, (_, i) => i + 1).some((h) => hourHasAnyAvailable(h, ampm));
  }, [hourHasAnyAvailable]);

  // If current selection becomes disabled, move to first enabled slot.
  useEffect(() => {
    if (!clinicId || !doctorId || !apptDate) return;
    if (!allowedTimes.size) return;
    if (allowedTimes.has(requestedTime) && !disabledTimes.has(requestedTime)) return;
    const next = (availability?.slots ?? []).find((t) => !disabledTimes.has(t));
    if (!next) return;
    const p = parseHHMMToPicker(next);
    setApptHour(p.hour12);
    setApptMinute(p.minute);
    setApptAmPm(p.ampm);
  }, [allowedTimes, apptDate, availability?.slots, clinicId, disabledTimes, doctorId, requestedTime]);

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
    const list = clinicsQuery.data;
    if (!list?.length || clinicId) return;
    setClinicId(list[0].id);
  }, [clinicId, clinicsQuery.data]);

  useEffect(() => {
    const list = doctorsQuery.data;
    if (!list?.length) return;
    if (!doctorId || !list.some((d) => d.id === doctorId)) setDoctorId(list[0].id);
  }, [doctorId, doctorsQuery.data]);

  const socket = useMemo(() => getSocket(), []);

  const etaTokenId = openVisit?.tokenId ?? booking?.tokenId ?? null;

  // Live location -> socket 'patient:update_location' (backend stores in Redis + emits ETA).
  useEffect(() => {
    if (!etaTokenId) return;
    if (!navigator.geolocation) {
      setGeoStatus("Geolocation not supported");
      return;
    }

    setGeoStatus("Requesting location…");
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoStatus("Location active");
        socket.emit("patient:update_location", {
          tokenId: etaTokenId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        setGeoStatus(err.message || "Location permission denied");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [etaTokenId, socket]);

  useEffect(() => {
    if (!accessToken || !user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "patient") {
      router.replace(roleHomePath(user.role));
      return;
    }

    socket.connect();

    const doctorRoomId = openVisit?.doctorId ?? booking?.doctorId;

    function onConnect() {
      setStatus("Connected");
      if (doctorRoomId) {
        socket.emit("patient:join_queue", { doctorId: doctorRoomId });
      }
    }

    function onDisconnect() {
      setStatus("Disconnected");
    }

    function onEta(payload: Record<string, unknown>) {
      const p = payload as {
        status?: string;
        tokensAhead?: number;
        waitAtClinicMin?: number;
        travelTimeMin?: number;
        leaveHomeInMin?: number;
        shouldLeaveNow?: boolean;
        avgConsultMin?: number;
      };
      if (p.status && p.status !== "waiting") {
        setEtaMetrics(null);
        setEtaBanner(`Queue status: ${p.status}`);
        return;
      }
      const tokensAhead = typeof p.tokensAhead === "number" ? p.tokensAhead : undefined;
      const travelTimeMin = typeof p.travelTimeMin === "number" ? p.travelTimeMin : undefined;
      const waitAtClinicMin = typeof p.waitAtClinicMin === "number" ? p.waitAtClinicMin : undefined;
      const leaveHomeInMin = typeof p.leaveHomeInMin === "number" ? p.leaveHomeInMin : undefined;
      const shouldLeaveNow = Boolean(p.shouldLeaveNow);

      if (
        tokensAhead === undefined ||
        travelTimeMin === undefined ||
        waitAtClinicMin === undefined ||
        leaveHomeInMin === undefined
      ) {
        setEtaMetrics(null);
        setEtaBanner("Waiting for ETA data…");
        return;
      }

      setEtaMetrics({
        tokensAhead,
        travelTimeMin,
        waitAtClinicMin,
        leaveHomeInMin,
        shouldLeaveNow,
        avgConsultMin: typeof p.avgConsultMin === "number" ? p.avgConsultMin : undefined,
      });
      setEtaBanner(
        shouldLeaveNow
          ? "You should head to the clinic now."
          : `Plan to leave home in about ${leaveHomeInMin} min so you arrive on time.`,
      );
    }

    function invalidateOpenVisit() {
      void queryClient.invalidateQueries({ queryKey: ["patient", "openVisit"] });
    }

    function onYourTurn() {
      setEtaMetrics(null);
      setEtaBanner("Your turn — please go to the doctor now.");
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
        socket.emit("patient:join_queue", { doctorId: data.doctorId });
      }
      setEtaMetrics(null);
      setEtaBanner("Booking confirmed. Allow location to see live ETA.");
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

  const connected = status === "Connected";
  /** Always show Live ETA on patient home — empty state before booking, hero once in queue. */
  const showEtaPanel = Boolean(user?.role === "patient");

  return (
    <div className="flex flex-1 flex-col bg-zinc-100">
      <AppShellHeader
        displayName={user?.name ?? "Patient"}
        roleBadge="Patient"
        liveConnected={connected}
        onSignOut={() => {
          setBooking(null);
          logout();
          router.replace("/login");
        }}
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        {/* Live ETA first — primary focus while in queue */}
        {showEtaPanel ? (
          <section
            className="overflow-hidden rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-1 shadow-md"
            aria-labelledby="live-eta-heading"
          >
            <div className="rounded-xl bg-white/90 p-4 backdrop-blur-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 id="live-eta-heading" className="text-lg font-bold tracking-tight text-zinc-900">
                    Live ETA
                  </h2>
                  <p className="mt-0.5 text-xs font-medium text-zinc-600">
                    Based on queue position, travel time, and typical visit length.
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-800">
                  Location: <span className="text-zinc-950">{geoStatus}</span>
                </div>
              </div>

              {!etaTokenId ? (
                <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/50 px-4 py-6 text-center">
                  <p className="text-base font-semibold text-zinc-900">Your live ETA will show here</p>
                  <p className="mt-2 text-sm text-zinc-700">
                    After you book, keep location on — we combine queue position, travel time, and visit
                    length so you know when to leave.
                  </p>
                </div>
              ) : etaMetrics ? (
                <>
                  <p className="mt-4 text-center text-2xl font-extrabold leading-tight text-zinc-950 sm:text-3xl">
                    {etaMetrics.shouldLeaveNow ? (
                      <>
                        Leave <span className="text-emerald-600">now</span>
                      </>
                    ) : (
                      <>
                        Leave in{" "}
                        <span className="text-emerald-600">~{etaMetrics.leaveHomeInMin} min</span>
                      </>
                    )}
                  </p>
                  {etaBanner ? (
                    <p className="mt-2 text-center text-sm font-medium text-zinc-700">{etaBanner}</p>
                  ) : null}
                  <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center">
                      <div className="text-2xl font-bold tabular-nums text-zinc-900">{etaMetrics.tokensAhead}</div>
                      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                        Ahead
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center">
                      <div className="text-2xl font-bold tabular-nums text-zinc-900">{etaMetrics.travelTimeMin}</div>
                      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                        Travel (min)
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center">
                      <div className="text-2xl font-bold tabular-nums text-zinc-900">{etaMetrics.waitAtClinicMin}</div>
                      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                        At clinic (min)
                      </div>
                    </div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center">
                      <div className="text-2xl font-bold tabular-nums text-zinc-900">
                        {etaMetrics.avgConsultMin ?? "—"}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                        Avg visit (min)
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center">
                  <p className="text-base font-semibold text-zinc-900">
                    {etaBanner ?? "Waiting for ETA — allow location if prompted."}
                  </p>
                  <p className="mt-2 text-xs text-zinc-600">
                    We refresh this when the queue moves or your position updates.
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {openVisitQuery.isPending ? (
          <Card>
            <div className="text-sm font-semibold">Your visit</div>
            <p className="mt-1 text-sm text-zinc-600">Checking your queue status…</p>
          </Card>
        ) : openVisit ? (
          <Card>
            <div className="text-base font-bold text-zinc-900">Current visit</div>
            <p className="mt-1 text-sm text-zinc-600">
              Booking is hidden until this visit finishes (completed or skipped by the clinic).
            </p>
            <div className="mt-3 space-y-2 text-sm text-zinc-900">
              <div>
                Token <span className="font-semibold">#{openVisit.tokenNumber}</span>
                <span className="ml-2 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-900">
                  {visitStatusLabel(openVisit.status)}
                </span>
              </div>
              <div className="text-sm font-medium text-zinc-700">
                {formatApptTimeDisplay(openVisit.apptDate, openVisit.apptTime)}
              </div>
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer font-medium text-zinc-600 hover:text-zinc-800">
                  Technical details
                </summary>
                <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{openVisit.tokenId}</p>
              </details>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="text-base font-bold text-zinc-900">Book appointment</div>
            <p className="mt-1 text-xs text-zinc-600">
              Choose a doctor, then book. The app calls{" "}
              <code className="rounded bg-zinc-100 px-1">POST /api/queue/book</code> with your JWT.
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <label className="text-xs font-medium text-zinc-800">
                Clinic
                <div className="mt-1">
                  {clinicsQuery.isLoading ? (
                    <div className="text-xs text-zinc-500">Loading clinics…</div>
                  ) : clinicsQuery.isError ? (
                    <div className="text-xs text-red-600">Could not load clinics.</div>
                  ) : !clinicsQuery.data?.length ? (
                    <div className="text-xs text-zinc-500">No clinics yet.</div>
                  ) : (
                    <select
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                      value={clinicId}
                      onChange={(e) => setClinicId(e.target.value)}
                    >
                      {clinicsQuery.data.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
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
                    <Input
                      type="date"
                      min={todayLocalDate()}
                      value={apptDate}
                      onChange={(e) => setApptDate(e.target.value)}
                    />
                  </div>
                </label>
                <label className="text-xs font-medium text-zinc-800">
                  Time
                  <div className="mt-1">
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                        value={apptHour}
                        onChange={(e) => setApptHour(Number(e.target.value))}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                          <option key={h} value={h} disabled={!hourHasAnyAvailable(h, apptAmPm)}>
                            {h}
                          </option>
                        ))}
                      </select>
                      <select
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                        value={apptMinute}
                        onChange={(e) => setApptMinute(Number(e.target.value))}
                      >
                        {[0, 15, 30, 45].map((m) => (
                          <option key={m} value={m} disabled={isBlocked(apptHour, m, apptAmPm)}>
                            {String(m).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                      <select
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                        value={apptAmPm}
                        onChange={(e) => setApptAmPm(e.target.value as "AM" | "PM")}
                      >
                        <option value="AM" disabled={!ampmHasAnyAvailable("AM")}>
                          AM
                        </option>
                        <option value="PM" disabled={!ampmHasAnyAvailable("PM")}>
                          PM
                        </option>
                      </select>
                    </div>
                    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                      Selected: <span className="font-semibold text-zinc-900">{formatAmPm(requestedTime)}</span>
                      {availabilityQuery.isFetching ? <span className="ml-2 text-zinc-500">Refreshing…</span> : null}
                      {!allowedTimes.has(requestedTime) ? (
                        <span className="ml-2 font-semibold text-amber-800">Outside schedule</span>
                      ) : disabledTimes.has(requestedTime) ? (
                        <span className="ml-2 font-semibold text-red-700">Not available</span>
                      ) : (
                        <span className="ml-2 font-semibold text-emerald-700">Available</span>
                      )}
                    </div>
                    {availability?.reason ? (
                      <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {availability.reason}
                      </div>
                    ) : null}
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
                  !clinicId ||
                  !doctorId ||
                  !apptDate ||
                  !allowedTimes.has(requestedTime) ||
                  disabledTimes.has(requestedTime)
                }
                onClick={() =>
                  bookMutation.mutate({ clinicId, doctorId, apptDate, apptTime: requestedTime })
                }
              >
                {bookMutation.isPending ? "Booking…" : "Book & get token"}
              </Button>
            </div>
          </Card>
        )}

      </main>
    </div>
  );
}
