/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AnalysisResults } from "@/components/analysis/AnalysisResults";

const baseProps = {
  profile: { id: "profile-1", name: "Senior QA Engineer", seniority_level: "Senior" },
  fileName: "candidate-cv.pdf",
  createdAt: "2026-01-15T10:00:00.000Z",
};

const multiCategoryQuestions = [
  {
    id: "q1",
    category: "missing_elements",
    question: "The CV shows no k6 experience. How would you load-test this API?",
    rationale: "The role lists k6 in expected skills but the CV omits it.",
    suggested_answer: "Describe k6 scripts, thresholds, and CI integration.",
  },
  {
    id: "q2",
    category: "vague_claims",
    question: "You wrote that you improved quality significantly — what metric changed?",
    rationale: "The claim has no measurable outcome.",
    suggested_answer: null,
  },
  {
    id: "q3",
    category: "anomalies",
    question: "Your timeline shows overlapping employer dates — can you clarify?",
    rationale: "Two roles list 2022–2024 with overlapping months.",
    suggested_answer: "Candidate should reconcile the dates.",
  },
];

describe("AnalysisResults", () => {
  it("renders match summary and all questions under correct category headings", () => {
    render(
      <AnalysisResults
        {...baseProps}
        matchSummary="Strong Playwright coverage; gap on performance testing."
        questions={multiCategoryQuestions}
      />,
    );

    expect(screen.getByText("Strong Playwright coverage; gap on performance testing.")).toBeInTheDocument();
    expect(screen.getByText("The CV shows no k6 experience. How would you load-test this API?")).toBeInTheDocument();
    expect(
      screen.getByText("You wrote that you improved quality significantly — what metric changed?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Your timeline shows overlapping employer dates — can you clarify?")).toBeInTheDocument();

    const missingHeading = screen.getByRole("heading", { name: /Missing Elements/i });
    const missingSection = missingHeading.closest("section");
    expect(missingSection).toBeTruthy();
    if (missingSection) {
      expect(within(missingSection).getByText(/k6 experience/)).toBeInTheDocument();
    }

    const vagueHeading = screen.getByRole("heading", { name: /Vague Claims/i });
    const vagueSection = vagueHeading.closest("section");
    expect(vagueSection).toBeTruthy();
    if (vagueSection) {
      expect(within(vagueSection).getByText(/improved quality significantly/)).toBeInTheDocument();
    }
  });

  it('shows "No questions were generated." when questions is empty', () => {
    render(<AnalysisResults {...baseProps} matchSummary="No issues found in this pass." questions={[]} />);

    expect(screen.getByText("No questions were generated.")).toBeInTheDocument();
    expect(screen.getByText("No issues found in this pass.")).toBeInTheDocument();
  });

  it("renders rationale and tolerates null suggested_answer", () => {
    render(<AnalysisResults {...baseProps} matchSummary="Summary" questions={[multiCategoryQuestions[1]]} />);

    expect(screen.getByText("The claim has no measurable outcome.")).toBeInTheDocument();
    expect(screen.queryByText("Suggested answer")).not.toBeInTheDocument();
  });

  it('labels a custom-only analysis "Custom requirements" with a snippet, not "Unknown profile"', () => {
    render(
      <AnalysisResults
        profile={null}
        customRequirements="Senior QA with k6 and Playwright load-testing experience required."
        fileName="candidate-cv.pdf"
        createdAt="2026-01-15T10:00:00.000Z"
        matchSummary="Summary"
        questions={[]}
      />,
    );

    expect(screen.getByText(/Custom requirements/)).toBeInTheDocument();
    expect(screen.getByText(/Senior QA with k6 and Playwright load-testing experience required\./)).toBeInTheDocument();
    expect(screen.queryByText("Unknown profile")).not.toBeInTheDocument();
  });

  it("surfaces custom requirements alongside the profile name when both are present", () => {
    render(
      <AnalysisResults
        {...baseProps}
        customRequirements="Must also have GraphQL contract-testing experience."
        matchSummary="Summary"
        questions={[]}
      />,
    );

    expect(screen.getByText(/Senior QA Engineer.*\+ custom requirements/)).toBeInTheDocument();
    expect(screen.getByText(/Must also have GraphQL contract-testing experience\./)).toBeInTheDocument();
  });

  it("surfaces project context when provided", () => {
    render(
      <AnalysisResults
        profile={null}
        customRequirements="Senior QA engineer."
        projectContext="FinTech payments domain, Scrum, TypeScript stack."
        fileName="candidate-cv.pdf"
        createdAt="2026-01-15T10:00:00.000Z"
        matchSummary="Summary"
        questions={[]}
      />,
    );

    expect(screen.getByText("Project context:")).toBeInTheDocument();
    expect(screen.getByText(/FinTech payments domain, Scrum, TypeScript stack\./)).toBeInTheDocument();
  });
});
