export class LinkedInScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkedInScrapeError";
  }
}

export class LinkedInAuthError extends LinkedInScrapeError {
  constructor(message = "LinkedIn authentication failed or session expired") {
    super(message);
    this.name = "LinkedInAuthError";
  }
}

export class LinkedInNotFoundError extends LinkedInScrapeError {
  constructor(message = "LinkedIn profile not found") {
    super(message);
    this.name = "LinkedInNotFoundError";
  }
}

export class LinkedInTimeoutError extends LinkedInScrapeError {
  constructor(message = "LinkedIn profile scrape timed out") {
    super(message);
    this.name = "LinkedInTimeoutError";
  }
}
