function getCurrentTimeContext() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now);

  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return {
    iso: now.toISOString(),
    timezone: 'Africa/Lagos',
    weekday: values.weekday,
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    formatted:
      `${values.weekday}, ${values.day} ${values.month} ${values.year}, ` +
      `${values.hour}:${values.minute}:${values.second} Africa/Lagos`
  };
}

module.exports = {
  getCurrentTimeContext
};
