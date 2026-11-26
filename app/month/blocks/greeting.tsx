"use client";

export function greetingFor(names: string[]): string {
  if (names.length <= 1) return `Oi, ${names[0] ?? ""}`;
  return `Oi, ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function Greeting({ people }: { people: { name: string }[] }) {
  const greeting = greetingFor(people.map((p) => p.name));
  return <p className="ds-greet-hello">{greeting} 👋</p>;
}
