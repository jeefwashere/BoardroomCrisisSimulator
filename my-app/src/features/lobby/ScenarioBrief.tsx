import LobbyIcon from './LobbyIcon'

import { SCENARIO_BRIEF } from './scenarioBriefModel'

/** The scenario brief, loaded automatically for every room: opens the PDF in a new tab. */
export default function ScenarioBrief() {
    return <a className="lobby-upload-button lobby-brief" href={SCENARIO_BRIEF.url} target="_blank" rel="noreferrer" title={`Scenario brief loaded: ${SCENARIO_BRIEF.title}. Opens the PDF.`}>
        <LobbyIcon name="document" /><span>{SCENARIO_BRIEF.label}</span><LobbyIcon name="check" className="lobby-brief-check" />
    </a>
}
