const RAMP = " .:-+=*#%@";
const SEATS = ["smith", "atelier", "critic", "scout", "prover", "scribe"];
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function greetingFrame(elapsed: number, reduced = false, columns = 40, rows = 4) {
  const time = reduced ? 1_200 : Math.max(0, Math.min(1_200, elapsed));
  const output: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < columns; x++) {
      const wave = Math.sin(x * 0.19 + time * 0.004) + Math.sin(y * 1.3 - time * 0.003) + Math.sin((x + y) * 0.08 + time * 0.002);
      const luminance = (wave + 3) / 6;
      line += RAMP[Math.round(luminance * (RAMP.length - 1))];
    }
    output.push(line);
  }
  return output.join("\n");
}

export function starMark() {
  return "  *\n* * *\n  *";
}

const MARKS = ".:-+=*#%@";

export function collabFrame(active: string[], tick: number, motion: boolean) {
  const names = new Set(active.map((item) => item.split(/[\s·]/)[0]));
  const mark = (seat: string) => {
    const on = names.has(seat);
    const glyph = !on ? "." : motion ? MARKS[tick % MARKS.length]! : "*";
    return glyph + " ".repeat(seat.length - 1);
  };
  const bar = (seat: string) => (names.has(seat) ? "=" : ".").repeat(seat.length);
  return [SEATS.join(" "), SEATS.map(mark).join(" "), SEATS.map(bar).join(" ")].join("\n");
}

export function spinnerFrame(tick: number, motion: boolean) {
  return motion ? SPINNER[tick % SPINNER.length]! : "•";
}
