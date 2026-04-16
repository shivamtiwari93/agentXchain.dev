export function pushDetail(details, label, value, options = {}) {
  if (value == null || value === '') {
    return;
  }

  details.push({
    label,
    value: String(value),
    mono: options.mono === true,
  });
}
