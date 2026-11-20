self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "Kindred (AI Companion)", body: "You have a new check-in.", url: "/" };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: "kindred-proactive",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(clients.openWindow(targetUrl));
});
