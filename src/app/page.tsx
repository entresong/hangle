import { Game } from "@/components/Game";

export default function Home() {
  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-1 flex-col overflow-hidden">
      <Game />
    </div>
  );
}
