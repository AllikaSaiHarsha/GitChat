import { expect, test } from '@playwright/test';

function uniqueId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function register(page, username) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Purlway' })).toBeVisible();
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: `Hi, ${username}` })).toBeVisible();
}

test('a new member creates a room and sends a realtime message', async ({ page }, testInfo) => {
  const id = uniqueId();
  const username = `e2e${id}`;
  const room = `e2e-${id}`;
  const message = `A realtime message ${id}`;

  await register(page, username);
  await page.getByLabel('New room name').fill(room);
  await page.getByLabel('New room password').fill('room-password-123');
  await page.getByRole('button', { name: 'Create room' }).click();

  await expect(page.getByRole('heading', { name: room, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Welcome to #${room}` })).toBeVisible();
  const messages = page.getByRole('log', { name: `Messages in #${room}` });
  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.fill(message);
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Send' }).click();
  } else {
    await composer.press('Enter');
  }
  await expect(messages.getByText(message)).toBeVisible();
});

test('a registered session resumes and the command palette opens and closes by keyboard', async ({ page }) => {
  const username = `e2e${uniqueId()}`;

  await register(page, username);
  await page.reload();
  await expect(page.getByRole('heading', { name: `Hi, ${username}` })).toBeVisible();

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});
