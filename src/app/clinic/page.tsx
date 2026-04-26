"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { roleHomePath } from "@/lib/roleHome";
import {
  ApiError,
  clinicAdminCreateException,
  clinicAdminGetMe,
  clinicAdminGetDoctorSchedule,
  clinicAdminLinkMyClinic,
  clinicAdminListAppointments,
  clinicAdminListDoctors,
  clinicAdminListExceptions,
  clinicAdminUpsertDoctorSchedule,
  clinicAdminUpdateException,
  clinicAdminUpdateMe,
  listClinics,
  type ClinicDirectoryItem,
  type ClinicAdminAppointmentRow,
  type ClinicAdminDoctorRow,
  type ClinicScheduleExceptionRow,
} from "@/lib/api";
import { AppShellHeader } from "@/components/layout/AppShellHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

function ClinicSettingsPanel({
  clinic,
  onSave,
  saving,
}: {
  clinic: { id: string; name: string; address: string | null };
  onSave: (params: { name: string; address?: string | null }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(clinic.name);
  const [address, setAddress] = useState(clinic.address ?? "");

  return (
    <div className="mt-3 space-y-3">
      <label className="text-xs font-medium text-zinc-800">
        Name
        <div className="mt-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </label>
      <label className="text-xs font-medium text-zinc-800">
        Address
        <div className="mt-1">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </label>
      <Button
        type="button"
        disabled={saving || !name.trim()}
        onClick={() => onSave({ name: name.trim(), address: address.trim() || null })}
      >
        {saving ? "Saving…" : "Save clinic"}
      </Button>
    </div>
  );
}

export default function ClinicPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, accessToken, logout } = useAuthStore();
  const [tab, setTab] = useState<"doctors" | "appointments" | "exceptions" | "settings">("appointments");
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);

  const todayIso = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const [rangeFrom, setRangeFrom] = useState(todayIso);
  const [rangeTo, setRangeTo] = useState(todayIso);

  const [exceptionError, setExceptionError] = useState<string | null>(null);
  const [exForm, setExForm] = useState<{
    id?: string | null;
    date: string;
    type: "closed" | "open";
    doctorId: string;
    allDay: boolean;
    fromTime: string;
    toTime: string;
    note: string;
  }>({
    id: null,
    date: todayIso,
    type: "closed",
    doctorId: "",
    allDay: true,
    fromTime: "09:00",
    toTime: "17:00",
    note: "",
  });

  useEffect(() => {
    if (!accessToken || !user) {
      router.replace("/login");
      return;
    }
    if (user.role === "patient" || user.role === "doctor") {
      router.replace(roleHomePath(user.role));
      return;
    }
  }, [accessToken, router, user]);

  const enabled = Boolean(accessToken && user && user.role !== "patient" && user.role !== "doctor");

  const clinicQuery = useQuery({
    queryKey: ["clinicAdmin", "me"],
    queryFn: clinicAdminGetMe,
    enabled,
    staleTime: 30_000,
  });

  const clinicsDirectoryQuery = useQuery({
    queryKey: ["clinics", "directory"],
    queryFn: listClinics,
    enabled,
    staleTime: 60_000,
  });

  const [selectedLinkClinicId, setSelectedLinkClinicId] = useState<string>("");
  const effectiveLinkClinicId = selectedLinkClinicId || clinicsDirectoryQuery.data?.[0]?.id || "";

  const linkClinicMut = useMutation({
    mutationFn: clinicAdminLinkMyClinic,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "me"] });
      void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "doctors"] });
      void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "appointments"] });
      void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "exceptions"] });
    },
  });

  const doctorsQuery = useQuery({
    queryKey: ["clinicAdmin", "doctors"],
    queryFn: clinicAdminListDoctors,
    enabled,
    staleTime: 30_000,
  });

  const apptsQuery = useQuery({
    queryKey: ["clinicAdmin", "appointments", rangeFrom, rangeTo],
    queryFn: () => clinicAdminListAppointments({ from: rangeFrom, to: rangeTo }),
    enabled: enabled && Boolean(rangeFrom && rangeTo),
    refetchInterval: 25_000,
  });

  const exceptionsQuery = useQuery({
    queryKey: ["clinicAdmin", "exceptions", rangeFrom, rangeTo],
    queryFn: () => clinicAdminListExceptions({ from: rangeFrom, to: rangeTo }),
    enabled: enabled && Boolean(rangeFrom && rangeTo),
    staleTime: 10_000,
  });

  const updateClinicMut = useMutation({
    mutationFn: clinicAdminUpdateMe,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "me"] }),
  });

  const createExMut = useMutation({
    mutationFn: clinicAdminCreateException,
    onSuccess: () => {
      setExceptionError(null);
      void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "exceptions", rangeFrom, rangeTo] });
      setExForm((p) => ({ ...p, id: null }));
    },
    onError: (e: unknown) => setExceptionError(e instanceof ApiError ? e.message : "Create failed"),
  });

  const updateExMut = useMutation({
    mutationFn: clinicAdminUpdateException,
    onSuccess: () => {
      setExceptionError(null);
      void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "exceptions", rangeFrom, rangeTo] });
      setExForm((p) => ({ ...p, id: null }));
    },
    onError: (e: unknown) => setExceptionError(e instanceof ApiError ? e.message : "Update failed"),
  });

  const clinic = clinicQuery.data ?? null;
  const doctors = (doctorsQuery.data ?? []) as ClinicAdminDoctorRow[];
  const appointments = (apptsQuery.data ?? []) as ClinicAdminAppointmentRow[];
  const exceptions = (exceptionsQuery.data ?? []) as ClinicScheduleExceptionRow[];

  const selectedDoctor = selectedDoctorId ? doctors.find((d) => d.id === selectedDoctorId) ?? null : null;

  const doctorScheduleQuery = useQuery({
    queryKey: ["clinicAdmin", "doctorSchedule", selectedDoctorId],
    queryFn: () => clinicAdminGetDoctorSchedule(selectedDoctorId as string),
    enabled: enabled && Boolean(selectedDoctorId),
    staleTime: 10_000,
    onSuccess: (data) => {
      const s = data.schedule;
      if (!s) return;
      setSchedDays(s.availableDays);
      setSchedFrom(s.availableFrom);
      setSchedTo(s.availableTo);
    },
  });

  const [schedDays, setSchedDays] = useState<Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">>([
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
  ]);
  const [schedFrom, setSchedFrom] = useState("09:00");
  const [schedTo, setSchedTo] = useState("17:00");
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Schedule editor values are reset on doctor click, then hydrated in `doctorScheduleQuery.onSuccess`.

  const upsertDoctorScheduleMut = useMutation({
    mutationFn: clinicAdminUpsertDoctorSchedule,
    onSuccess: () => {
      setScheduleError(null);
      void queryClient.invalidateQueries({ queryKey: ["clinicAdmin", "doctorSchedule", selectedDoctorId] });
    },
    onError: (e: unknown) => setScheduleError(e instanceof ApiError ? e.message : "Save failed"),
  });

  return (
    <div className="flex flex-1 flex-col bg-zinc-100">
      <AppShellHeader
        displayName={clinic?.name ?? user?.name ?? "Clinic"}
        roleBadge={user?.role === "admin" ? "Admin" : user?.role === "clinic_staff" ? "Staff" : "Clinic"}
        onSignOut={() => {
          logout();
          router.replace("/login");
        }}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
        {clinicQuery.isError && clinicQuery.error instanceof ApiError && clinicQuery.error.status === 403 ? (
          <Card>
            <div className="text-sm font-semibold text-zinc-900">Link clinic</div>
            <p className="mt-1 text-xs text-zinc-600">
              This clinic account is not linked to a clinic yet. Select a clinic to continue.
            </p>

            {clinicsDirectoryQuery.isLoading ? (
              <div className="mt-3 text-sm text-zinc-600">Loading clinics…</div>
            ) : clinicsDirectoryQuery.isError ? (
              <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Could not load clinics.</div>
            ) : (
              <div className="mt-3 space-y-3">
                <select
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                  value={effectiveLinkClinicId}
                  onChange={(e) => setSelectedLinkClinicId(e.target.value)}
                >
                  {(clinicsDirectoryQuery.data as ClinicDirectoryItem[] | undefined)?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <Button
                  type="button"
                  disabled={linkClinicMut.isPending || !effectiveLinkClinicId}
                  onClick={() => linkClinicMut.mutate({ clinicId: effectiveLinkClinicId })}
                >
                  {linkClinicMut.isPending ? "Linking…" : "Link clinic"}
                </Button>
              </div>
            )}
          </Card>
        ) : null}

        <Card>
          <div className="text-base font-bold text-zinc-900">Clinic dashboard</div>
          <p className="mt-1 text-sm text-zinc-600">Doctors, appointments, and availability overrides — in one place.</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ["appointments", "Appointments"],
                ["doctors", "Doctors"],
                ["exceptions", "Exceptions"],
                ["settings", "Clinic settings"],
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

        <Card>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-zinc-800">
              From
              <div className="mt-1">
                <input
                  type="date"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                />
              </div>
            </label>
            <label className="text-xs font-medium text-zinc-800">
              To
              <div className="mt-1">
                <input
                  type="date"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                />
              </div>
            </label>
          </div>
        </Card>

        {tab === "doctors" ? (
          <Card>
            <div className="text-sm font-semibold">Doctors ({doctors.length})</div>
            {doctorsQuery.isLoading ? (
              <div className="mt-2 text-sm text-zinc-600">Loading doctors…</div>
            ) : doctorsQuery.isError ? (
              <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Could not load doctors.</div>
            ) : !doctors.length ? (
              <div className="mt-2 text-sm text-zinc-600">No doctors linked to this clinic yet.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {doctors.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      selectedDoctorId === d.id
                        ? "border-zinc-300 bg-zinc-50"
                        : "border-zinc-200 bg-white hover:bg-zinc-50"
                    }`}
                    onClick={() => {
                      setScheduleError(null);
                      setSelectedDoctorId(d.id);
                      // Reset editor defaults immediately; it will hydrate from API if schedule exists.
                      setSchedDays(["mon", "tue", "wed", "thu", "fri"]);
                      setSchedFrom("09:00");
                      setSchedTo("17:00");
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900">{d.name}</div>
                        <div className="mt-1 text-xs text-zinc-600">
                          {d.speciality ?? "—"} · {d.isActive ? "Active" : "Inactive"}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-zinc-500">Schedule</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedDoctor ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">Schedule · {selectedDoctor.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Clinic staff can view. Only clinic admin can edit and save.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                    onClick={() => setSelectedDoctorId(null)}
                  >
                    Close
                  </button>
                </div>

                {doctorScheduleQuery.isLoading ? (
                  <div className="mt-3 text-sm text-zinc-600">Loading schedule…</div>
                ) : doctorScheduleQuery.isError ? (
                  <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                    Could not load schedule.
                  </div>
                ) : (
                  <>
                    <div className="mt-3">
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
                          const on = schedDays.includes(id);
                          return (
                            <button
                              key={id}
                              type="button"
                              className={`rounded-xl border px-2 py-2 text-xs font-semibold ${
                                on
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                  : "border-zinc-200 bg-white text-zinc-700"
                              }`}
                              onClick={() =>
                                setSchedDays((prev) =>
                                  prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
                                )
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="text-xs font-medium text-zinc-800">
                        From
                        <div className="mt-1">
                          <input
                            type="time"
                            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                            value={schedFrom}
                            onChange={(e) => setSchedFrom(e.target.value)}
                          />
                        </div>
                      </label>
                      <label className="text-xs font-medium text-zinc-800">
                        To
                        <div className="mt-1">
                          <input
                            type="time"
                            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15"
                            value={schedTo}
                            onChange={(e) => setSchedTo(e.target.value)}
                          />
                        </div>
                      </label>
                    </div>

                    {scheduleError ? (
                      <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{scheduleError}</div>
                    ) : null}

                    <div className="mt-3 flex gap-2">
                      <Button
                        type="button"
                        disabled={
                          user?.role !== "clinic_admin" ||
                          upsertDoctorScheduleMut.isPending ||
                          !selectedDoctorId ||
                          schedDays.length === 0 ||
                          !/^\d{2}:\d{2}$/.test(schedFrom) ||
                          !/^\d{2}:\d{2}$/.test(schedTo)
                        }
                        onClick={() => {
                          setScheduleError(null);
                          if (schedFrom >= schedTo) {
                            setScheduleError("From time must be before to time.");
                            return;
                          }
                          if (!selectedDoctorId) return;
                          upsertDoctorScheduleMut.mutate({
                            doctorId: selectedDoctorId,
                            availableDays: schedDays,
                            availableFrom: schedFrom,
                            availableTo: schedTo,
                          });
                        }}
                      >
                        {upsertDoctorScheduleMut.isPending ? "Saving…" : "Save schedule"}
                      </Button>
                      {user?.role !== "clinic_admin" ? (
                        <div className="self-center text-xs text-zinc-500">Only clinic_admin can save.</div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </Card>
        ) : null}

        {tab === "appointments" ? (
          <Card>
            <div className="text-sm font-semibold">Appointments</div>
            {apptsQuery.isLoading ? (
              <div className="mt-2 text-sm text-zinc-600">Loading appointments…</div>
            ) : apptsQuery.isError ? (
              <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                Could not load appointments.
              </div>
            ) : !appointments.length ? (
              <div className="mt-2 text-sm text-zinc-600">No appointments in this range.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {appointments.map((a) => (
                  <div key={a.id} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-900">
                        {a.apptDate} · {a.apptTime}
                      </div>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                        {a.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      <span className="font-medium text-zinc-700">Doctor:</span> {a.doctor.name} ·{" "}
                      <span className="font-medium text-zinc-700">Patient:</span> {a.patient.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : null}

        {tab === "exceptions" ? (
          <Card>
            <div className="text-sm font-semibold">Exceptions</div>
            <p className="mt-1 text-xs text-zinc-500">
              Clinic-wide closures set doctorId empty. For doctor leave, pick a doctorId (optional).
            </p>

            <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-3">
              <div className="text-sm font-semibold text-zinc-900">{exForm.id ? "Edit exception" : "Add exception"}</div>

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
                <label className="text-xs font-medium text-zinc-800">
                  Type
                  <div className="mt-1">
                    <select
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                      value={exForm.type}
                      onChange={(e) => setExForm((p) => ({ ...p, type: e.target.value as "closed" | "open" }))}
                    >
                      <option value="closed">Closed</option>
                      <option value="open">Open</option>
                    </select>
                  </div>
                </label>
              </div>

              <label className="mt-3 block text-xs font-medium text-zinc-800">
                Doctor (optional)
                <div className="mt-1">
                  <select
                    className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300"
                    value={exForm.doctorId}
                    onChange={(e) => setExForm((p) => ({ ...p, doctorId: e.target.value }))}
                  >
                    <option value="">Clinic-wide</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="mt-3 flex items-center gap-2 text-xs font-medium text-zinc-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-zinc-900"
                  checked={exForm.allDay}
                  onChange={(e) => setExForm((p) => ({ ...p, allDay: e.target.checked }))}
                />
                All day
              </label>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-zinc-800">
                  From time
                  <div className="mt-1">
                    <input
                      type="time"
                      disabled={exForm.allDay}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15 disabled:bg-zinc-50"
                      value={exForm.fromTime}
                      onChange={(e) => setExForm((p) => ({ ...p, fromTime: e.target.value }))}
                    />
                  </div>
                </label>
                <label className="text-xs font-medium text-zinc-800">
                  To time
                  <div className="mt-1">
                    <input
                      type="time"
                      disabled={exForm.allDay}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-300 focus:ring-2 focus:ring-zinc-900/15 disabled:bg-zinc-50"
                      value={exForm.toTime}
                      onChange={(e) => setExForm((p) => ({ ...p, toTime: e.target.value }))}
                    />
                  </div>
                </label>
              </div>

              <label className="mt-3 block text-xs font-medium text-zinc-800">
                Note (optional)
                <div className="mt-1">
                  <Input value={exForm.note} onChange={(e) => setExForm((p) => ({ ...p, note: e.target.value }))} />
                </div>
              </label>

              {exceptionError ? (
                <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{exceptionError}</div>
              ) : null}

              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  disabled={createExMut.isPending || updateExMut.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(exForm.date)}
                  onClick={() => {
                    setExceptionError(null);
                    if (!exForm.allDay && exForm.fromTime >= exForm.toTime) {
                      setExceptionError("From time must be before to time.");
                      return;
                    }
                    const payload = {
                      date: exForm.date,
                      type: exForm.type,
                      doctorId: exForm.doctorId || null,
                      fromTime: exForm.allDay ? null : exForm.fromTime,
                      toTime: exForm.allDay ? null : exForm.toTime,
                      note: exForm.note || null,
                    } as const;
                    if (exForm.id) updateExMut.mutate({ id: exForm.id, ...payload });
                    else createExMut.mutate(payload);
                  }}
                >
                  {createExMut.isPending || updateExMut.isPending ? "Saving…" : exForm.id ? "Save changes" : "Add exception"}
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

            <div className="mt-3">
              {exceptionsQuery.isLoading ? (
                <div className="text-sm text-zinc-600">Loading exceptions…</div>
              ) : exceptionsQuery.isError ? (
                <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Could not load exceptions.</div>
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
                                  ex.type === "closed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                                }`}
                              >
                                {ex.type}
                              </span>
                              <span className="text-xs text-zinc-600">{labelTime}</span>
                            </div>
                            {ex.note ? <div className="mt-1 truncate text-xs text-zinc-500">{ex.note}</div> : null}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              className="bg-zinc-100 text-zinc-900 active:bg-zinc-200"
                              onClick={() =>
                                setExForm({
                                  id: ex.id,
                                  date: ex.date,
                                  type: ex.type,
                                  doctorId: ex.doctorId ?? "",
                                  allDay: !(ex.fromTime && ex.toTime),
                                  fromTime: ex.fromTime ?? "09:00",
                                  toTime: ex.toTime ?? "17:00",
                                  note: ex.note ?? "",
                                })
                              }
                            >
                              Edit
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        ) : null}

        {tab === "settings" ? (
          <Card>
            <div className="text-sm font-semibold">Clinic settings</div>
            {clinicQuery.isLoading ? (
              <div className="mt-2 text-sm text-zinc-600">Loading clinic…</div>
            ) : clinicQuery.isError ? (
              <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Could not load clinic.</div>
            ) : clinic ? (
              <ClinicSettingsPanel
                key={clinic.id}
                clinic={clinic}
                saving={updateClinicMut.isPending}
                onSave={(p) => updateClinicMut.mutate(p)}
              />
            ) : null}
          </Card>
        ) : null}
      </main>
    </div>
  );
}

