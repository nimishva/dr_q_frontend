"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface PatientBooking {
  doctorId: string;
  tokenId: string;
  tokenNumber: number;
  appointmentId: string;
  apptDate: string;
  apptTime: string;
}

interface PatientQueueState {
  booking: PatientBooking | null;
  setBooking: (b: PatientBooking | null) => void;
}

export const usePatientQueueStore = create<PatientQueueState>()(
  persist(
    (set) => ({
      booking: null,
      setBooking: (booking) => set(() => ({ booking })),
    }),
    {
      name: "doctor-queue-patient-booking",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ booking: s.booking }),
      skipHydration: true,
    },
  ),
);
