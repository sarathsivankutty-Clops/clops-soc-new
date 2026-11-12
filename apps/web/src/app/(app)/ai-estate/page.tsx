import { redirect } from "next/navigation";
// [HIDDEN-UI NAV-5 route hidden from navigation]
// import { AiChatCompliancePanel } from "@/components/ai-estate/AiChatCompliancePanel";
// import AiEstateView from "@/components/ai-estate/AiEstateView";

export const metadata = {
  title: "AI estate",
  description: "Observed AI apps, coding agents, MCP servers, provider keys and OAuth grants",
};

export default function AiEstatePage() {
  // [HIDDEN-UI NAV-5 redirect with permanent:false (307) to /dashboard]
  // return (
  //   <div className="space-y-6">
  //     <AiEstateView />
  //     <AiChatCompliancePanel />
  //   </div>
  // );
  redirect("/dashboard");
}
