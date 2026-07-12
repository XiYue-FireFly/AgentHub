import { describe, expect, it } from "vitest"
import { PROMPT_ORIGINS, type PromptOrigin } from "../../../shared/prompt-contract"
import {
  PROMPT_INGRESS_REGISTRY,
  requirePromptIngress
} from "../prompt-ingress-registry"

const LOOP_ORIGINS = [
  "internal:loop-candidate",
  "internal:loop-synthesizer",
  "internal:loop-judge",
  "internal:loop-executor"
] as const satisfies readonly PromptOrigin[]

describe("multi-model loop Prompt ingress registrations", () => {
  it("declares the four unique internal loop Prompt origins", () => {
    expect(PROMPT_ORIGINS.filter(origin => origin.startsWith("internal:loop-")))
      .toEqual(LOOP_ORIGINS)
    expect(new Set(LOOP_ORIGINS)).toHaveLength(4)
  })

  it("registers every loop origin as a sessionless internal ingress", () => {
    for (const origin of LOOP_ORIGINS) {
      expect(PROMPT_INGRESS_REGISTRY[origin]).toStrictEqual({
        policy: "internal",
        scope: "none",
        decisionCapability: "none"
      })
      expect(requirePromptIngress(origin)).toBe(PROMPT_INGRESS_REGISTRY[origin])
    }
  })
})
