"use client";

import { useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import { cn } from "../lib/cn";
import { SKILL_INPUT_LIMIT } from "../lib/engine";
import { formatNumber } from "../lib/format";
import { ACCENTS, PROFILES } from "../lib/mock-data";
import type { AgentId, Skill } from "../lib/types";
import { Drawer, DrawerHeader, drawerButton } from "./Drawer";

interface SkillsPanelProps {
  /** The operative whose skills are shown. Null closes the panel. */
  agentId: AgentId | null;
  onRun: (id: AgentId, skill: string, input: string) => void;
  onClose: () => void;
}

const GROUP_LABEL = "font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-accent";

function SkillList({ agentId, onRun, onClose }: SkillsPanelProps & { agentId: AgentId }) {
  const profile = PROFILES[agentId];
  const [openId, setOpenId] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const choose = (skill: Skill) => {
    setOpenId((current) => (current === skill.id ? null : skill.id));
    setPasted("");
  };

  const run = (event: FormEvent<HTMLFormElement>, skill: Skill) => {
    event.preventDefault();
    if (skill.input && !pasted.trim()) return;
    onRun(agentId, skill.id, pasted);
    onClose();
  };

  const group = (title: string, hint: string, skills: readonly Skill[]) => (
    <section className="border-b border-line px-5 py-4">
      <h3 className={GROUP_LABEL}>{title}</h3>
      <p className="mt-1 text-xs leading-5 text-mute">{hint}</p>
      <ul className="mt-3 grid gap-px border border-line bg-line">
        {skills.map((skill) => {
          const open = skill.id === openId;
          const over = pasted.length > SKILL_INPUT_LIMIT;
          return (
            <li key={skill.id} className="bg-panel">
              <button
                type="button"
                data-skill={skill.id}
                aria-expanded={open}
                aria-controls={`skill-${skill.id}`}
                onClick={() => choose(skill)}
                className={cn(
                  "block w-full rounded-none px-3 py-2.5 text-left transition-colors duration-75",
                  open ? "bg-raised" : "hover:bg-raised",
                )}
              >
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={cn("font-mono text-xs font-bold uppercase tracking-[0.12em]", open ? "text-accent" : "text-ink")}>
                    {skill.name}
                  </span>
                  {skill.input && (
                    <span className="border border-cyan/50 px-1 font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan">
                      Needs your data
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-mute">{skill.about}</span>
              </button>

              {open && (
                <form id={`skill-${skill.id}`} onSubmit={(event) => run(event, skill)} className="border-t border-line px-3 py-3">
                  {skill.input && (
                    <>
                      <label htmlFor="skill-input" className={GROUP_LABEL}>
                        {skill.input.label}
                      </label>
                      <textarea
                        id="skill-input"
                        value={pasted}
                        onChange={(event) => setPasted(event.target.value)}
                        placeholder={skill.input.placeholder}
                        rows={7}
                        spellCheck={false}
                        aria-describedby="skill-input-note"
                        className="mt-2 w-full rounded-none border border-line bg-void px-3 py-2 font-mono text-base leading-5 text-ink outline-none placeholder:text-mute/50 focus:border-accent md:text-xs"
                      />
                      <p id="skill-input-note" className={cn("mt-1 text-xs leading-5", over ? "text-pink" : "text-mute")}>
                        {over
                          ? `That is longer than this skill can take. Only the first ${formatNumber(SKILL_INPUT_LIMIT)} characters will be used.`
                          : "Paste it rough, straight from the screen. It goes to the connected model and nowhere else."}
                      </p>
                    </>
                  )}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="submit"
                      disabled={Boolean(skill.input) && !pasted.trim()}
                      className={drawerButton.solid}
                    >
                      <Play aria-hidden className="size-3" fill="currentColor" />
                      Run skill
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );

  const coreSkills = profile.skills.filter((skill) => skill.core);
  const onDemand = profile.skills.filter((skill) => !skill.core);

  return (
    <>
      <DrawerHeader
        titleId="skills-title"
        eyebrow={
          <>
            Skills <span aria-hidden>{"//"}</span> {profile.unit} <span aria-hidden>{"//"}</span>{" "}
            {profile.role}
          </>
        }
        title={agentId}
        closeLabel="Close skills"
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <p className="border-b border-line px-5 py-3 text-sm leading-6 text-ink/85">
          Pick a skill and {agentId} does it now, then files the result in the vault. Running one
          replaces whatever it is working on.
        </p>
        {group("Core", "Deploy works through these in order. Run any one again here.", coreSkills)}
        {group(
          "On demand",
          "Run these when you need them. The ones that need your data work on whatever you paste in.",
          onDemand,
        )}
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
          {profile.skills.length} skills <span aria-hidden>{"//"}</span> one model call each
        </p>
        <button type="button" onClick={onClose} className={drawerButton.quiet}>
          Done
        </button>
      </footer>
    </>
  );
}

/** Everything one operative can do, runnable on the spot. */
export function SkillsPanel(props: SkillsPanelProps) {
  const { agentId, onClose } = props;
  const accent = agentId ? ACCENTS[PROFILES[agentId].accent].hex : ACCENTS.cyan.hex;
  return (
    <Drawer open={agentId !== null} onClose={onClose} labelledBy="skills-title" accent={accent}>
      {agentId && <SkillList {...props} agentId={agentId} />}
    </Drawer>
  );
}
