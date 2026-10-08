const LAYERS = ["back hair", "body", "outfit", "eyes", "mouth", "front hair"];

interface Props {
  charName: string;
  emotion: string | null;
  busy: boolean;
}

/** Placeholder for the paper-doll avatar (step 2). Shows the layer stack and her latest emotion tag. */
export default function StagePanel({ charName, emotion, busy }: Props) {
  return (
    <aside className="stage" aria-label={`${charName}'s avatar area`}>
      <h1 className="stage-name">{charName}</h1>
      <p className="stage-feel">{busy ? "typing..." : emotion ? `feeling ${emotion}` : "waiting for you"}</p>

      <div className="sheets" aria-hidden="true">
        {LAYERS.map((name, i) => (
          <div
            key={name}
            className="sheet"
            style={{
              top: i * 38,
              zIndex: i,
              transform: `rotate(${i % 2 ? 1.4 : -1.4}deg)`,
            }}
          >
            {name}
          </div>
        ))}
      </div>

      <p className="stage-note">Her avatar layers go here in step 2.</p>
    </aside>
  );
}
