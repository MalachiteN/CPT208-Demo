import { ServiceResult } from "../models/types";

// Mock hint responses
const MOCK_HINTS = [
  "You may begin by stating your view clearly and concisely.",
  "Consider addressing the previous speaker's point before sharing your own.",
  "Try to build upon what others have said to show active listening.",
  "You could start by asking a thought-provoking question to the group.",
  "Think about providing a concrete example to support your argument.",
  "Acknowledge different perspectives before presenting your stance.",
  "Consider summarizing the key points discussed so far.",
  "You might want to suggest a direction for the discussion to move forward.",
];

export function getHint(): ServiceResult<string> {
  const hintIndex = Math.floor(Math.random() * MOCK_HINTS.length);
  return {
    success: true,
    data: MOCK_HINTS[hintIndex],
  };
}

export const HintService = {
  getHint,
};

export default HintService;
