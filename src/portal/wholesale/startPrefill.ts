/** Read initial entry fields only; never confirms the odometer or bypasses the guide. */
export function startPrefill(params: URLSearchParams) {
  const read = (key: string) => params.get(key) ?? "";
  const odometer = read("km");
  return {
    rego: read("rego").toUpperCase(), state: read("state"), year: read("year"),
    make: read("make"), model: read("model"), badge: read("badge"),
    odo: /^\d+$/.test(odometer) ? odometer : "", adLink: read("adLink"), asking: read("asking"),
  };
}