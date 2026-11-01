export type AssistantRiskTier = "T0" | "T1" | "T2" | "T3" | "T4";

export interface AssistantAttachment {
  name: string;
  contentType: string;
  size: number;
  file?: File;
}

export interface AssistantChatRequest {
  message: string;
  attachments: readonly AssistantAttachment[];
}

export interface AssistantProposal {
  id: string;
  summary: string;
  riskTier: AssistantRiskTier;
}

export type AssistantChatResult =
  | { status: "unavailable" }
  | {
      status: "available";
      reply: string;
      proposals?: readonly AssistantProposal[];
    };

export interface AssistantClient {
  send(request: AssistantChatRequest): Promise<AssistantChatResult>;
}

export type AssistantTransport = (request: AssistantChatRequest) => Promise<AssistantChatResult>;

export function createAssistantClient(transport?: AssistantTransport): AssistantClient {
  return {
    send: async (request) => {
      if (!transport) return { status: "unavailable" };
      return transport(request);
    },
  };
}

export function assistantProposalRequiresPasskey(proposal: AssistantProposal): boolean {
  return proposal.riskTier === "T3";
}

export function assistantProposalIsDenied(proposal: AssistantProposal): boolean {
  return proposal.riskTier === "T4";
}
