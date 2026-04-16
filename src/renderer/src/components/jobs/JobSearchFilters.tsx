import { useMemo } from 'react'
import type { JobsSearchFiltersPersisted } from '@/types/app'
import {
  JOB_SEARCH_RECENCY_OPTIONS,
  JOB_SEARCH_SORT_OPTIONS,
  JOB_SEARCH_DISTANCE_OPTIONS,
  JOB_SEARCH_SALARY_OPTIONS,
  JOB_SEARCH_EXPERIENCE_OPTIONS,
  JOB_SEARCH_TYPE_OPTIONS,
  JOB_SEARCH_REMOTE_OPTIONS,
  DEFAULT_JOBS_SEARCH_FILTERS
} from './jobs-helpers'

type JobSearchFiltersProps = {
  jobFilters: JobsSearchFiltersPersisted
  onFilterChange: (patch: Partial<JobsSearchFiltersPersisted>) => void
  onArrayFilterChange: (
    key: 'jobsSearchExperienceLevels' | 'jobsSearchJobTypes' | 'jobsSearchRemoteTypes',
    sorted: string[]
  ) => void
}

export function JobSearchFilters({
  jobFilters,
  onFilterChange,
  onArrayFilterChange
}: JobSearchFiltersProps) {
  const activeFilterCount = useMemo(() => {
    const d = DEFAULT_JOBS_SEARCH_FILTERS
    let count = 0
    if (jobFilters.jobsSearchRecencySeconds !== d.jobsSearchRecencySeconds) count++
    if (jobFilters.jobsSearchSortBy !== d.jobsSearchSortBy) count++
    if (jobFilters.jobsSearchDistanceMiles !== d.jobsSearchDistanceMiles) count++
    if (jobFilters.jobsSearchSalaryFloor !== d.jobsSearchSalaryFloor) count++
    if (jobFilters.jobsSearchExperienceLevels.length > 0) count++
    if (jobFilters.jobsSearchJobTypes.length > 0) count++
    if (jobFilters.jobsSearchRemoteTypes.length > 0) count++
    if (jobFilters.jobsSearchFewApplicants !== d.jobsSearchFewApplicants) count++
    if (jobFilters.jobsSearchVerifiedOnly !== d.jobsSearchVerifiedOnly) count++
    if (jobFilters.jobsSearchEasyApplyOnly !== d.jobsSearchEasyApplyOnly) count++
    return count
  }, [jobFilters])

  return (
    <details className="section--collapsible jobs-search-filters">
      <summary className="section__toggle">
        {activeFilterCount > 0 ? `Search settings (${activeFilterCount} active)` : 'Search settings'}
      </summary>
      <div className="jobs-search-filters__body">
        <div className="jobs-search-filters__row jobs-search-filters__row--selects">
          <label className="jobs-search-filters__field" htmlFor="jobs-filter-recency">
            <span className="jobs-search-filters__label">Recency</span>
            <select
              id="jobs-filter-recency"
              value={jobFilters.jobsSearchRecencySeconds}
              onChange={(e) => {
                const v = Number(e.target.value)
                onFilterChange({ jobsSearchRecencySeconds: v })
              }}
            >
              {JOB_SEARCH_RECENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-search-filters__field" htmlFor="jobs-filter-sort">
            <span className="jobs-search-filters__label">Sort by</span>
            <select
              id="jobs-filter-sort"
              value={jobFilters.jobsSearchSortBy}
              onChange={(e) => {
                const v = e.target.value === 'R' ? 'R' : 'DD'
                onFilterChange({ jobsSearchSortBy: v })
              }}
            >
              {JOB_SEARCH_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-search-filters__field" htmlFor="jobs-filter-distance">
            <span className="jobs-search-filters__label">Distance</span>
            <select
              id="jobs-filter-distance"
              value={jobFilters.jobsSearchDistanceMiles}
              onChange={(e) => {
                const v = Number(e.target.value)
                onFilterChange({ jobsSearchDistanceMiles: v })
              }}
            >
              {JOB_SEARCH_DISTANCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-search-filters__field" htmlFor="jobs-filter-salary">
            <span className="jobs-search-filters__label">Min salary</span>
            <select
              id="jobs-filter-salary"
              value={jobFilters.jobsSearchSalaryFloor}
              onChange={(e) => {
                const v = Number(e.target.value)
                onFilterChange({ jobsSearchSalaryFloor: v })
              }}
            >
              {JOB_SEARCH_SALARY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="jobs-search-filters__groups-row">
          <div className="jobs-search-filters__group">
            <span className="jobs-search-filters__group-label" id="jobs-filter-exp-label">
              Experience
            </span>
            <div
              className="jobs-search-filters__checks"
              role="group"
              aria-labelledby="jobs-filter-exp-label"
            >
              {JOB_SEARCH_EXPERIENCE_OPTIONS.map((opt) => (
                <label key={opt.id} className="jobs-search-filters__check">
                  <input
                    type="checkbox"
                    checked={jobFilters.jobsSearchExperienceLevels.includes(opt.id)}
                    onChange={() => {
                      const next = new Set(jobFilters.jobsSearchExperienceLevels)
                      if (next.has(opt.id)) next.delete(opt.id)
                      else next.add(opt.id)
                      const sorted = [...next].sort()
                      onArrayFilterChange('jobsSearchExperienceLevels', sorted)
                    }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className="jobs-search-filters__group">
            <span className="jobs-search-filters__group-label" id="jobs-filter-jt-label">
              Job type
            </span>
            <div
              className="jobs-search-filters__checks"
              role="group"
              aria-labelledby="jobs-filter-jt-label"
            >
              {JOB_SEARCH_TYPE_OPTIONS.map((opt) => (
                <label key={opt.id} className="jobs-search-filters__check">
                  <input
                    type="checkbox"
                    checked={jobFilters.jobsSearchJobTypes.includes(opt.id)}
                    onChange={() => {
                      const next = new Set(jobFilters.jobsSearchJobTypes)
                      if (next.has(opt.id)) next.delete(opt.id)
                      else next.add(opt.id)
                      const sorted = [...next].sort()
                      onArrayFilterChange('jobsSearchJobTypes', sorted)
                    }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className="jobs-search-filters__group">
            <span className="jobs-search-filters__group-label" id="jobs-filter-wt-label">
              Remote
            </span>
            <div
              className="jobs-search-filters__checks"
              role="group"
              aria-labelledby="jobs-filter-wt-label"
            >
              {JOB_SEARCH_REMOTE_OPTIONS.map((opt) => (
                <label key={opt.id} className="jobs-search-filters__check">
                  <input
                    type="checkbox"
                    checked={jobFilters.jobsSearchRemoteTypes.includes(opt.id)}
                    onChange={() => {
                      const next = new Set(jobFilters.jobsSearchRemoteTypes)
                      if (next.has(opt.id)) next.delete(opt.id)
                      else next.add(opt.id)
                      const sorted = [...next].sort()
                      onArrayFilterChange('jobsSearchRemoteTypes', sorted)
                    }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <span className="jobs-search-filters__group-label" style={{ marginTop: 'var(--space-3)' }}>
              Quality
            </span>
            <div className="jobs-search-filters__checks">
              <label className="jobs-search-filters__flag">
                <input
                  type="checkbox"
                  checked={jobFilters.jobsSearchEasyApplyOnly}
                  onChange={(e) => {
                    onFilterChange({ jobsSearchEasyApplyOnly: e.target.checked })
                  }}
                />
                Easy Apply only
              </label>
              <label className="jobs-search-filters__flag">
                <input
                  type="checkbox"
                  checked={jobFilters.jobsSearchFewApplicants}
                  onChange={(e) => {
                    onFilterChange({ jobsSearchFewApplicants: e.target.checked })
                  }}
                />
                Few applicants
              </label>
              <label className="jobs-search-filters__flag">
                <input
                  type="checkbox"
                  checked={jobFilters.jobsSearchVerifiedOnly}
                  onChange={(e) => {
                    onFilterChange({ jobsSearchVerifiedOnly: e.target.checked })
                  }}
                />
                Verified jobs only
              </label>
            </div>
          </div>
        </div>
        <p className="jobs-search-filters__hint caption">
          Applied when you run Find jobs. Change a filter, then search again to refresh results.
        </p>
      </div>
    </details>
  )
}
