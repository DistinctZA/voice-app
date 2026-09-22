import { create } from "zustand";
import type { SidebarSection } from "@/components/Sidebar";

interface NavigationStore {
  requestedSection: SidebarSection | null;
  openSection: (section: SidebarSection) => void;
  clearRequest: () => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  requestedSection: null,
  openSection: (section) => set({ requestedSection: section }),
  clearRequest: () => set({ requestedSection: null }),
}));
