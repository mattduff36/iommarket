import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsForm } from "@/app/(admin)/admin/settings/settings-form";
import { SETTING_KEYS } from "@/lib/config/setting-keys";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/admin/settings", () => ({
  updateSiteSetting: vi.fn(),
  deleteSiteSetting: vi.fn(),
}));

describe("SettingsForm", () => {
  it("gives every operational override input an accessible label", () => {
    render(
      <SettingsForm
        settings={[]}
        envDefaults={{
          [SETTING_KEYS.FREE_LISTING_WINDOW_DAYS]: "30",
          [SETTING_KEYS.LAUNCH_FREE_UNTIL]: "not set",
          [SETTING_KEYS.FREE_LAUNCH_SLOTS_TOTAL]: "100",
          [SETTING_KEYS.MONITORING_ALERT_EMAILS]: "not set",
          [SETTING_KEYS.MONITORING_ALERT_WEBHOOK_URL]: "not set",
          [SETTING_KEYS.MONITORING_ALERT_MIN_SEVERITY]: "HIGH",
          [SETTING_KEYS.MONITORING_ALERT_COOLDOWN_MINUTES]: "30",
        }}
      />,
    );

    expect(screen.getByLabelText("Free Listing Window (days)")).toBeTruthy();
    expect(screen.getByLabelText("Monitoring Alert Webhook URL")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).not.toHaveLength(0);
    expect(screen.getAllByRole("spinbutton")).not.toHaveLength(0);
  });
});
