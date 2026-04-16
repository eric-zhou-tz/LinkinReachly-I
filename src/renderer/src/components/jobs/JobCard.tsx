import type { ScoredJob } from './jobs-helpers'
import { ExternalLink } from '../ExternalLink'

type JobCardProps = {
  job: ScoredJob
  isExpanded: boolean
  onToggleExpand: (key: string) => void
  hasScreened: boolean
  hasSearched: boolean
  queuedJobUrls: Set<string>
  appliedJobUrls: Set<string>
  outreachSentUrls: Set<string>
  tailoredResumes: Map<string, { headline: string; summary: string }>
  tailoringJobUrl: string | null
  reachOutBusyUrl: string | null
  onAddToQueue: (job: ScoredJob) => void
  onTailorResume: (job: ScoredJob) => void
  onReachOut: (job: ScoredJob) => void
  onFeedback: (jobUrl: string, feedback: 'positive' | 'negative' | undefined) => void
}

export function JobCard({
  job,
  isExpanded,
  onToggleExpand,
  hasScreened,
  hasSearched,
  queuedJobUrls,
  appliedJobUrls,
  outreachSentUrls,
  tailoredResumes,
  tailoringJobUrl,
  reachOutBusyUrl,
  onAddToQueue,
  onTailorResume,
  onReachOut,
  onFeedback
}: JobCardProps) {
  const key = job.jobUrl || `${job.title}-${job.company}`
  return (
    <div
      className={`jobs-card ${isExpanded ? 'jobs-card--expanded' : ''}`}
      aria-expanded={isExpanded}
    >
      <div className="jobs-card__main">
        <div className="jobs-card__info" onClick={() => onToggleExpand(key)} role="button" tabIndex={0} aria-label={`${job.title} at ${job.company}. ${isExpanded ? 'Collapse' : 'Expand'} details.`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand(key) } }}>
          <strong className="jobs-card__title">{job.title}</strong>
          <div className="jobs-card__meta-line">
            {job.easyApply ? (
              <span className="jobs-surface-badge jobs-surface-badge--easy" title="Easy Apply — can auto-apply">Easy Apply</span>
            ) : (
              <span className="jobs-surface-badge jobs-surface-badge--external" title="External — apply on company site">External</span>
            )}
            <span className="jobs-card__meta-dot" aria-hidden="true" />
            <span className="jobs-card__company">{job.company}</span>
            {job.location && (
              <>
                <span className="jobs-card__meta-dot" aria-hidden="true" />
                <span className="jobs-card__location">{job.location}</span>
              </>
            )}
            {job.postedDate && (
              <>
                <span className="jobs-card__meta-dot" aria-hidden="true" />
                <span>{job.postedDate}</span>
              </>
            )}
          </div>
        </div>
        <div className="jobs-card__right">
          {job.resumeMatchPercent != null && (
            <span
              className={`jobs-match-signal jobs-match-signal--${job.resumeMatchPercent >= 70 ? 'strong' : job.resumeMatchPercent >= 40 ? 'moderate' : 'weak'}`}
              title={job.resumeMatchReason || `R\u00e9sum\u00e9 match ${job.resumeMatchPercent}%`}
              aria-label={`${job.resumeMatchPercent >= 70 ? 'Strong' : job.resumeMatchPercent >= 40 ? 'Moderate' : 'Weak'} match, ${job.resumeMatchPercent} percent`}
            >
              <span className="jobs-match-signal__dot" aria-hidden="true" />
              {job.resumeMatchPercent >= 70 ? 'Strong match' : job.resumeMatchPercent >= 40 ? 'Moderate' : 'Weak'}
            </span>
          )}
          {!hasScreened && job.resumeMatchPercent == null && hasSearched && (
            <span
              className="jobs-rank-placeholder"
              title="No r\u00e9sum\u00e9 match yet. Save a r\u00e9sum\u00e9 or profile in Settings, then search again."
            >
              {'\u2014'}
            </span>
          )}
          {job.jobUrl && (
            appliedJobUrls.has(job.jobUrl) ? (
              <span className="jobs-applied-pill" title="Already applied to this job">Applied {'\u2713'}</span>
            ) : queuedJobUrls.has(job.jobUrl) ? (
              <span className="jobs-queued-pill" title="Already in queue">Queued {'\u2713'}</span>
            ) : job.easyApply ? (
              <button
                type="button"
                className="btn btn-sm btn-outline-brand"
                onClick={(e) => { e.stopPropagation(); onAddToQueue(job) }}
                title="Add to apply queue"
              >
                + Queue
              </button>
            ) : (
              <ExternalLink
                href={job.jobUrl}
                className="btn btn-sm btn-ghost"
                title="Open on company website to apply"
              >
                Review {'\u2192'}
              </ExternalLink>
            )
          )}
          <span className={`jobs-card__chevron ${isExpanded ? 'jobs-card__chevron--open' : ''}`} aria-hidden="true">{'\u25B8'}</span>
        </div>
      </div>
      {isExpanded && (
        <div className="jobs-card__detail">
          {job.resumeMatchReason && (
            <p className="jobs-card__resume-reason">{job.resumeMatchReason}</p>
          )}
          {job.reason && (
            <p className="jobs-card__reason">{job.reason}</p>
          )}
          {hasScreened && (job.titleFit || job.seniorityMatch || job.locationFit || job.companyFit) && (
            <div className="jobs-card__dimensions">
              {job.titleFit != null && <span className="jobs-dim" title="Title fit" aria-label={`Title fit score ${job.titleFit} out of 10`}><span className="jobs-dim__label">Title</span> <span className={`jobs-dim__value ${job.titleFit >= 7 ? 'jobs-dim__value--high' : job.titleFit >= 4 ? 'jobs-dim__value--mid' : 'jobs-dim__value--low'}`}>{job.titleFit}</span></span>}
              {job.seniorityMatch != null && <span className="jobs-dim" title="Seniority match" aria-label={`Seniority match score ${job.seniorityMatch} out of 10`}><span className="jobs-dim__label">Level</span> <span className={`jobs-dim__value ${job.seniorityMatch >= 7 ? 'jobs-dim__value--high' : job.seniorityMatch >= 4 ? 'jobs-dim__value--mid' : 'jobs-dim__value--low'}`}>{job.seniorityMatch}</span></span>}
              {job.locationFit != null && <span className="jobs-dim" title="Location fit" aria-label={`Location fit score ${job.locationFit} out of 10`}><span className="jobs-dim__label">Location</span> <span className={`jobs-dim__value ${job.locationFit >= 7 ? 'jobs-dim__value--high' : job.locationFit >= 4 ? 'jobs-dim__value--mid' : 'jobs-dim__value--low'}`}>{job.locationFit}</span></span>}
              {job.companyFit != null && <span className="jobs-dim" title="Company fit" aria-label={`Company fit score ${job.companyFit} out of 10`}><span className="jobs-dim__label">Company</span> <span className={`jobs-dim__value ${job.companyFit >= 7 ? 'jobs-dim__value--high' : job.companyFit >= 4 ? 'jobs-dim__value--mid' : 'jobs-dim__value--low'}`}>{job.companyFit}</span></span>}
            </div>
          )}
          {(job.matchedSkills?.length || job.missingSkills?.length) ? (
            <div className="jobs-card__skills">
              {job.matchedSkills?.length ? (
                <span className="jobs-skills jobs-skills--match" title="Skills you have that match this role">
                  <span className="jobs-skills__label">{'\u2713'} Match:</span> {job.matchedSkills.join(', ')}
                </span>
              ) : null}
              {job.missingSkills?.length ? (
                <span className="jobs-skills jobs-skills--gap" title="Required skills not found in your background">
                  <span className="jobs-skills__label">{'\u2717'} Gap:</span> {job.missingSkills.join(', ')}
                </span>
              ) : null}
            </div>
          ) : null}
          {hasScreened && job.resumeMatchPercent != null && (
            <div className="jobs-card__feedback" onClick={(e) => e.stopPropagation()}>
              <span className="jobs-feedback__label">Accurate?</span>
              <button
                type="button"
                className={`btn-feedback${job.userFeedback === 'positive' ? ' btn-feedback--active' : ''}`}
                title="Good match"
                aria-label="Mark as good match"
                onClick={() => {
                  onFeedback(job.jobUrl, job.userFeedback === 'positive' ? undefined : 'positive')
                }}
              >{'\u25B2'}</button>
              <button
                type="button"
                className={`btn-feedback${job.userFeedback === 'negative' ? ' btn-feedback--active' : ''}`}
                title="Bad match"
                aria-label="Mark as bad match"
                onClick={() => {
                  onFeedback(job.jobUrl, job.userFeedback === 'negative' ? undefined : 'negative')
                }}
              >{'\u25BC'}</button>
            </div>
          )}
          {job.nextStep && (
            <p className="jobs-card__next-step">{job.nextStep}</p>
          )}
          {job.description && (
            <p className="jobs-card__jd-text mt-sm">{job.description.length > 400 ? job.description.slice(0, 400) + '\u2026' : job.description}</p>
          )}
          <div className="jobs-card__actions" onClick={(e) => e.stopPropagation()}>
            {job.jobUrl && (
              <ExternalLink
                href={job.jobUrl}
                className="jobs-card__link"
              >
                View job
              </ExternalLink>
            )}
            {job.jobUrl && outreachSentUrls.has(job.jobUrl) && (
              <span className="jobs-badge jobs-badge--outreach" title="Outreach sent to hiring manager">Reached Out</span>
            )}
          </div>
          {job.jobUrl && (appliedJobUrls.has(job.jobUrl) || job.description) && (
            <details className="jobs-card__more-actions" onClick={(e) => e.stopPropagation()}>
              <summary className="jobs-card__more-toggle" aria-label={`More actions for ${job.title} at ${job.company}`}>More actions</summary>
              <div className="jobs-card__more-actions-body">
                {appliedJobUrls.has(job.jobUrl) && !outreachSentUrls.has(job.jobUrl) && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-brand"
                    disabled={reachOutBusyUrl === job.jobUrl}
                    aria-busy={reachOutBusyUrl === job.jobUrl}
                    aria-label={`Reach out to hiring manager for ${job.title} at ${job.company}`}
                    onClick={() => void onReachOut(job)}
                    title="Find the hiring manager and send a personalized connection invite"
                  >
                    {reachOutBusyUrl === job.jobUrl ? 'Reaching out\u2026' : 'Reach Out'}
                  </button>
                )}
                {job.description && (
                  <button
                    type="button"
                    className={`btn btn-sm ${tailoredResumes.has(job.jobUrl!) ? 'btn-ghost' : 'btn-outline-brand'}`}
                    disabled={tailoringJobUrl === job.jobUrl}
                    aria-busy={tailoringJobUrl === job.jobUrl}
                    aria-label={`Tailor resume for ${job.title} at ${job.company}`}
                    onClick={() => void onTailorResume(job)}
                    title="AI-rewrite your headline and summary for this job"
                  >
                    {tailoringJobUrl === job.jobUrl ? 'Tailoring\u2026' : tailoredResumes.has(job.jobUrl!) ? 'Re-tailor' : 'Tailor Resume'}
                  </button>
                )}
              </div>
            </details>
          )}
          {job.jobUrl && tailoredResumes.has(job.jobUrl) && (
            <div className="jobs-card__tailored">
              <div className="jobs-card__tailored-label">Tailored headline</div>
              <p className="jobs-card__tailored-text">{tailoredResumes.get(job.jobUrl)!.headline}</p>
              <div className="jobs-card__tailored-label">Tailored summary</div>
              <p className="jobs-card__tailored-text">{tailoredResumes.get(job.jobUrl)!.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
