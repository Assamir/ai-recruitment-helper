import { test, expect } from '@playwright/test';

test('cv analysis the main positive flow - paste in a cv and get an analysis', async ({ page }) => {
  await page.goto('http://localhost:4321/dashboard');
  await page.getByRole('link', { name: '+ New Analysis' }).click();
  await page.getByRole('button', { name: '▼ Paste CV text instead' }).click();
  await page.getByRole('textbox', { name: 'Paste the full CV text here...' }).click();
  await page.getByRole('textbox', { name: 'Paste the full CV text here...' }).fill('John Dog\n\nLooking for a highly skilled software engineer with\nexpertise in Java, test automation, and continuous\nintegration? Look no further! With over 7 years of\nexperience at Atena Usługi Informatyczne i Finansowe\nS.A. and recent roles at EPAM Systems and Kimputing,\nInc., I bring a wealth of knowledge to any project.\n\nGood knowledge of:\n• Java/Groovy language\n• GIT and SVN\n• Jenkins/CI\n• JMeter\n• IntelliJ\n• TestComplete (GUI automatization tool)\n• UML\n• SQL language\n• Guidewire databases structure\n• MSSQL Database\n• Docker\n');
  await page.getByRole('combobox').selectOption('758079c0-1523-41f5-9c0b-557d9bea0462');
  await page.getByRole('button', { name: 'Analyze CV' }).click();
  await expect(page.locator('astro-island')).toContainText('📋 Missing Elements');
  await expect(page.getByText('Match Summary')).toBeVisible();
  await expect(page.locator('astro-island')).toContainText('Match Summary');
  await page.getByRole('link', { name: '← Dashboard' }).click();
  await expect(page.locator('body')).toContainText('John Dog');
});
