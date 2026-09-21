.PHONY: all data clean-data analyze validate report schedule app test help

PYTHON ?= python3
PIP ?= pip3

help:
	@echo "TradeClock Makefile Commands:"
	@echo "  make data      - Download raw data and validate/clean feeds"
	@echo "  make analyze   - Compute recency-weighted metrics & trend quality scores"
	@echo "  make validate  - Run walk-forward testing, null hypothesis tests & stability"
	@echo "  make report    - Generate written report, self-contained HTML and charts"
	@echo "  make schedule  - Export production schedule/schedule.json"
	@echo "  make app       - Launch interactive Python Textual live terminal"
	@echo "  make test      - Run comprehensive pytest test suite"

data:
	$(PYTHON) -m tradeclock.download.runner
	$(PYTHON) -m tradeclock.clean.validator

analyze:
	$(PYTHON) -m tradeclock.classify.classifier

validate:
	$(PYTHON) -m tradeclock.validate.runner

report:
	$(PYTHON) -m tradeclock.report.generate_report

schedule:
	$(PYTHON) -m tradeclock.classify.classifier --export-schedule

app:
	$(PYTHON) -m tradeclock.terminal.app

test:
	pytest tests -v
