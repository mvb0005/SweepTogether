BACKEND_TEST_IMAGE := sweeptogether-backend-test

.PHONY: test test-watch test-coverage up down

# Build the backend test image. Cached after first run unless package.json changes.
.backend-image:
	docker build -t $(BACKEND_TEST_IMAGE) ./backend
	@touch .backend-image

# Run backend unit tests in a standalone container.
test: .backend-image
	docker run --rm $(BACKEND_TEST_IMAGE) node_modules/.bin/jest

# Run with coverage report.
test-coverage: .backend-image
	docker run --rm $(BACKEND_TEST_IMAGE) node_modules/.bin/jest --coverage

# Run in watch mode — mounts src/ so file changes are picked up without a rebuild.
test-watch: .backend-image
	docker run --rm -it \
		-v "$(PWD)/backend/src:/usr/src/app/src" \
		$(BACKEND_TEST_IMAGE) \
		node_modules/.bin/jest --watchAll

# Force rebuild the test image (e.g. after package.json changes).
test-build:
	docker build -t $(BACKEND_TEST_IMAGE) ./backend
	@touch .backend-image

up:
	docker-compose up --build

down:
	docker-compose down
