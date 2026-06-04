/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Smoke() {
  return <p>vitest jsdom smoke</p>;
}

describe("jsdom smoke", () => {
  it("renders text in the DOM", () => {
    render(<Smoke />);
    expect(screen.getByText("vitest jsdom smoke")).toBeInTheDocument();
  });
});
