import { describe, expect, test } from "bun:test";
import { selectArchitecture } from "./architecture-selection";

describe("selectArchitecture — paper archetypes", () => {
  test("planning (T=4, P_SA=0.57) → sas (capability saturation)", () => {
    const result = selectArchitecture({
      toolCount: 4,
      singleAgentBaseline: 0.57,
      sequential: true,
    });
    expect(result.architecture).toBe("sas");
    expect(result.config.n).toBe(1);
  });

  test("analysis (T=5, P_SA=0.35, decomposable) → centralized", () => {
    const result = selectArchitecture({
      toolCount: 5,
      singleAgentBaseline: 0.35,
      decomposable: true,
    });
    expect(result.architecture).toBe("centralized");
    expect(result.config).toMatchObject({ n: 3, r: 5 });
  });

  test("tool-heavy decomposable (T=16, low baseline) → decentralized", () => {
    const result = selectArchitecture({
      toolCount: 16,
      singleAgentBaseline: 0.3,
      decomposable: true,
    });
    expect(result.architecture).toBe("decentralized");
    expect(result.config).toMatchObject({ n: 3, d: 3 });
  });
});

describe("selectArchitecture — rule precedence", () => {
  test("capability saturation beats decomposability", () => {
    const result = selectArchitecture({
      toolCount: 5,
      singleAgentBaseline: 0.6,
      decomposable: true,
    });
    expect(result.architecture).toBe("sas");
  });

  test("sequential interdependence → sas", () => {
    const result = selectArchitecture({
      toolCount: 8,
      singleAgentBaseline: 0.2,
      sequential: true,
      decomposable: true,
    });
    expect(result.architecture).toBe("sas");
  });

  test("high-entropy search → decentralized", () => {
    const result = selectArchitecture({
      toolCount: 3,
      singleAgentBaseline: 0.32,
      highEntropySearch: true,
    });
    expect(result.architecture).toBe("decentralized");
  });

  test("ensemble sampling → independent", () => {
    const result = selectArchitecture({
      toolCount: 3,
      singleAgentBaseline: 0.3,
      ensemble: true,
    });
    expect(result.architecture).toBe("independent");
  });

  test("low tool count, no decomposition → sas", () => {
    const result = selectArchitecture({
      toolCount: 2,
      singleAgentBaseline: 0.3,
    });
    expect(result.architecture).toBe("sas");
  });

  test("high domain complexity, not decomposable → sas", () => {
    const result = selectArchitecture({
      toolCount: 6,
      singleAgentBaseline: 0.3,
      domainComplexity: 0.84,
    });
    expect(result.architecture).toBe("sas");
  });

  test("missing baseline does not force SAS", () => {
    const result = selectArchitecture({
      toolCount: 5,
      decomposable: true,
    });
    expect(result.architecture).toBe("centralized");
  });
});
