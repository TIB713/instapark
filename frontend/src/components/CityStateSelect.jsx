import { State, City } from "country-state-city";

export default function CityStateSelect({ state, city, onStateChange, onCityChange }) {
  const states = State.getStatesOfCountry("IN");
  const selectedState = states.find(s => s.name === state || s.isoCode === state);
  const cities = selectedState ? City.getCitiesOfState("IN", selectedState.isoCode) : [];

  return (
    <div className="grid grid-cols-2 gap-3">
      <select
        value={state || ""}
        onChange={e => {
          onStateChange(e.target.value);
          onCityChange("");
        }}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select State</option>
        {states.map(s => (
          <option key={s.isoCode} value={s.name}>{s.name}</option>
        ))}
      </select>

      <select
        value={city || ""}
        onChange={e => onCityChange(e.target.value)}
        disabled={!selectedState}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">Select City</option>
        {cities.map(c => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}
