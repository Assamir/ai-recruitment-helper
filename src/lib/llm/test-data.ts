export const SYNTHETIC_CV_TEXT = `
PROFESSIONAL SUMMARY
Senior QA Engineer with 7+ years of experience in software quality assurance, test automation, and team leadership. Proven track record of implementing comprehensive testing strategies across web, mobile, and API platforms. Passionate about delivering high-quality software through innovative testing approaches and continuous improvement methodologies. Adept at bridging the gap between development and operations teams through effective communication and collaborative problem-solving approaches.

WORK EXPERIENCE

QA Team Lead | TechVision Solutions | March 2022 - Present
- Lead a team of 5 QA engineers across 3 agile squads delivering a SaaS platform for healthcare compliance management, ensuring HIPAA-compliant data handling throughout the test lifecycle
- Introduced Playwright-based E2E test automation framework, achieving 85% coverage of critical user journeys including patient record management, appointment scheduling, and billing workflows
- Reduced production bug escape rate by 40% through implementation of shift-left testing practices including static analysis integration, unit test coverage gates, and early-stage performance profiling
- Collaborate with product owners to define acceptance criteria and ensure comprehensive test coverage for quarterly release cycles spanning 15-20 user stories per sprint
- Mentor junior QA engineers and conduct weekly knowledge-sharing sessions covering topics from test design patterns to advanced debugging techniques in distributed systems
- Implemented performance testing using k6 for API endpoints, identifying and resolving 12 critical bottlenecks before release including database connection pool exhaustion and memory leaks in WebSocket handlers
- Designed and implemented a custom test data generation framework that creates realistic synthetic patient records while maintaining referential integrity across 40+ database tables
- Established quality metrics dashboard tracking defect density, test coverage trends, mean time to detection, and release confidence scores, presented monthly to engineering leadership
- Coordinated cross-team testing efforts for a major platform migration from monolithic architecture to microservices, managing test strategy across 8 independent service teams
- Technologies: Playwright, TypeScript, k6, Jenkins CI/CD, PostgreSQL, REST APIs, Jira, Grafana, DataDog, AWS CloudWatch

Senior QA Engineer | DataStream Analytics | June 2019 - February 2022
- Designed and maintained automated test suites for a real-time data processing platform handling 2M+ events per second from IoT sensors across manufacturing facilities worldwide
- Built a custom Selenium Grid infrastructure supporting parallel execution across 20+ browser configurations, reducing total regression suite runtime from 6 hours to 45 minutes
- Developed comprehensive API test framework using Python and Requests library for microservices architecture spanning 35 services with complex event-driven communication patterns
- Performed exploratory testing sessions that uncovered 15+ critical edge cases in data pipeline including race conditions in stream processing, data corruption during failover scenarios, and timezone-related aggregation errors
- Created comprehensive test data management solution using SQL and Python scripts capable of generating realistic time-series datasets with configurable anomaly patterns for machine learning model validation
- Participated in architecture review meetings to assess testability of proposed designs, successfully advocating for contract testing between services and event schema versioning
- Led the initiative to implement chaos engineering practices using Gremlin, identifying 3 critical single points of failure in the data ingestion pipeline that were subsequently addressed
- Developed a custom monitoring solution that correlated test failures with infrastructure metrics, reducing mean time to root cause by 60% for intermittent test failures
- Wrote and maintained technical documentation for the QA process including onboarding guides, test strategy documents, and runbooks for common failure scenarios
- Technologies: Selenium WebDriver, Python, pytest, Docker, Kubernetes, Grafana, MySQL, Apache Kafka, Redis, Elasticsearch, Gremlin, Terraform

QA Engineer | WebCraft Digital Agency | January 2017 - May 2019
- Executed manual and automated testing for 10+ e-commerce web applications serving combined traffic of 500K monthly active users across retail, fashion, and electronics verticals
- Wrote automated regression tests using Cypress for React-based frontends, building a reusable component testing library that reduced new test creation time by 50%
- Performed cross-browser compatibility testing across Chrome, Firefox, Safari, and Edge, maintaining a compatibility matrix for 25+ client-specific configurations including mobile viewports and legacy browser support
- Conducted accessibility testing following WCAG 2.1 guidelines using axe-core, identifying and documenting 200+ accessibility violations across client projects and creating remediation guides for development teams
- Built a visual regression testing pipeline using Percy that caught UI inconsistencies before they reached staging environments, preventing an estimated 30 client-reported issues per quarter
- Implemented API contract testing for third-party payment gateway integrations (Stripe, PayPal, Klarna) ensuring backward compatibility during provider API version upgrades
- Created and maintained a shared test utilities package used across all agency projects, standardizing authentication flows, cart manipulation, and checkout process verification
- Documented test cases and defects in TestRail and Jira, establishing naming conventions and severity classification guidelines adopted across the QA department
- Technologies: Cypress, JavaScript, TestRail, BrowserStack, Charles Proxy, Postman, Percy, axe-core, Lighthouse

Junior QA Tester | StartupHub | August 2015 - December 2016
- Performed manual functional testing for a mobile banking application on iOS and Android platforms, covering 150+ test scenarios across account management, transfers, and payment features
- Created test plans and test cases based on user stories and business requirements, maintaining traceability matrices linking requirements to test coverage
- Reported and tracked defects using Bugzilla, consistently providing clear reproduction steps, environment details, and impact assessments that reduced developer investigation time
- Participated in daily standups and sprint retrospectives, contributing to process improvements that reduced bug reopening rate from 25% to 8% within 6 months
- Assisted in security testing activities including session management verification, input validation checks, and certificate pinning validation for the mobile application
- Supported production deployment verification through smoke test execution and post-deployment monitoring for 3 monthly release cycles
- Technologies: Manual testing, Bugzilla, TestFlight, Android Studio emulator, Charles Proxy, OWASP ZAP

QA Intern | GlobalSoft Corporation | June 2014 - July 2015
- Supported QA team in regression testing activities for an enterprise resource planning (ERP) system used by 50+ corporate clients
- Created and executed test cases for invoice processing, inventory management, and reporting modules
- Participated in user acceptance testing sessions with business stakeholders, documenting feedback and coordinating with development team on resolution priorities
- Developed basic test automation scripts using Selenium IDE for repetitive login and navigation scenarios
- Technologies: Manual testing, Selenium IDE, HP ALM, SQL Server Management Studio

EDUCATION
Bachelor of Science in Computer Science | State Technical University | 2011 - 2015
- Thesis: "Automated Detection of UI Inconsistencies Using Computer Vision Techniques"
- Relevant coursework: Software Engineering, Database Systems, Computer Networks, Statistics
- GPA: 3.7/4.0, Dean's List (6 semesters)

Master of Science in Software Engineering | Online University | 2018 - 2020
- Thesis: "Effectiveness of AI-Assisted Test Generation in Reducing Defect Escape Rates"
- Focus areas: Software Quality, Project Management, Machine Learning Applications
- Graduated with distinction

CERTIFICATIONS
- ISTQB Certified Tester - Foundation Level (2016)
- ISTQB Certified Tester - Advanced Level, Test Automation Engineer (2019)
- ISTQB Certified Tester - Advanced Level, Test Manager (2021)
- AWS Certified Cloud Practitioner (2021)
- AWS Certified Developer - Associate (2022)
- Certified Scrum Master (CSM) - Scrum Alliance (2020)
- Certified SAFe 5 Practitioner (2022)
- Google Cloud Professional Data Engineer (2023)

SKILLS
Programming Languages: Python, TypeScript, JavaScript, SQL, Bash, Java (basic), Go (learning)
Automation Tools: Playwright, Selenium WebDriver, Cypress, Appium, k6, JMeter, Gatling, Artillery
CI/CD: Jenkins, GitHub Actions, GitLab CI, Docker, Kubernetes, ArgoCD, Terraform
Testing Tools: Postman, Charles Proxy, BrowserStack, TestRail, Jira, Zephyr, qTest
Databases: PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch, DynamoDB
Cloud Platforms: AWS (EC2, Lambda, S3, RDS, CloudWatch), GCP (BigQuery, Cloud Functions)
Methodologies: Agile/Scrum, Kanban, SAFe, TDD, BDD, Shift-Left Testing, Chaos Engineering
Observability: Grafana, DataDog, New Relic, PagerDuty, Sentry
Other: REST API testing, GraphQL testing, Performance testing, Security testing, Accessibility testing, Contract testing, Visual regression testing

LANGUAGES
English - Fluent (C2, Cambridge Advanced Certificate)
German - Intermediate (B1, Goethe-Zertifikat)
Polish - Native
Spanish - Basic (A2, self-study)

NOTABLE ACHIEVEMENTS
- Speaker at TestConf 2023: "Scaling Test Automation in Microservices Architecture" (audience: 300+)
- Workshop facilitator at SeleniumConf 2022: "Building Resilient E2E Tests That Don't Flake"
- Published article on Medium: "From Manual to Automated: A Practical Migration Guide" (2021, 15K+ reads)
- Published article on Dev.to: "Contract Testing Patterns for Event-Driven Systems" (2023, 8K+ reads)
- Hackathon winner at QAFest 2022: Built an AI-powered test case generator prototype using GPT-3 that generated BDD scenarios from user story descriptions
- Open source contributor to Playwright project (3 merged PRs including a fix for WebSocket interception)
- Created and maintained "qa-toolkit" npm package with 2K+ weekly downloads, providing utilities for test data generation and API mocking
- Internal innovation award at TechVision Solutions (2023) for developing the automated test data generation framework
- Mentored 8 junior QA engineers over 3 years, with 5 receiving promotions to mid-level positions

PROFESSIONAL DEVELOPMENT
- Regular attendee of local QA meetup group (monthly since 2018)
- Completed "Machine Learning for Software Testing" course on Coursera (2023)
- Participating in beta testing program for Playwright's component testing features
- Contributing to ISTQB syllabus review committee for the AI Testing extension module

REFERENCES
Available upon request.
`.trim();

export const SYNTHETIC_JOB_PROFILE = `
QA Automation Engineer - Senior Level

We are looking for a Senior QA Automation Engineer to join our fintech team building a next-generation payment processing platform. The ideal candidate will have strong experience with test automation frameworks, API testing, and CI/CD integration.

Required Skills:
- 5+ years of experience in QA automation
- Strong proficiency in Playwright or Selenium WebDriver
- Experience with TypeScript or Python for test automation
- API testing experience with REST and GraphQL
- CI/CD pipeline integration (Jenkins, GitHub Actions)
- Experience with performance testing tools (k6, JMeter, Gatling)
- Database testing with SQL (PostgreSQL preferred)
- Understanding of microservices architecture
- ISTQB certification preferred
- Experience in fintech or regulated environments is a plus

Responsibilities:
- Design and implement automated test strategies for web and API testing
- Build and maintain CI/CD test pipelines
- Conduct performance and load testing for critical payment flows
- Collaborate with development teams on testability and quality gates
- Mentor junior QA team members
`.trim();
