import { createFileRoute } from "@tanstack/react-router";
import { AppVoiceAgentScreen } from "@/components/app-shell/account-screens";

export const Route = createFileRoute("/home/voice-agent")({
  component: AppVoiceAgentScreen,
});
