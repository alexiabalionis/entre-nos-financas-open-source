"use client";

export function greetingFor(names: string[]): string {
  if (names.length <= 1) return `Oi, ${names[0] ?? ""}`;
  return `Oi, ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function Greeting({ people }: { people: { name: string }[] }) {
  const greeting = greetingFor(people.map((p) => p.name));
  return (
    <h1 className="m-0 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
      {greeting}
    </h1>
  );
}
