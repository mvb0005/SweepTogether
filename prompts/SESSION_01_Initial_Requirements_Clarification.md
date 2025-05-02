# Session 1: Initial Requirements Clarification

**NOTE: The original prompt for this session is not available.**

## Session Notes

In this initial session, we focused on clarifying the requirements for the Mines game project. Several key questions were addressed:

### Q&A

* **Q:** What are the specific point values for 1st, 2nd, and 3rd place on a mine reveal?
  * **A:** Configurable per game with reasonable defaults.

* **Q:** How many points are lost for clicking a mine?
  * **A:** Configurable per game with reasonable defaults.

* **Q:** What is the duration of the player lockout after an error?
  * **A:** Configurable per game with reasonable defaults.

* **Q:** What is the desired size of the Minesweeper board (rows, columns, number of mines)? Or should this be configurable?
  * **A:** Configurable per game with reasonable defaults. Each game will have a "configuration" that is set with the rules at the time.

* **Q:** Is there a maximum number of players allowed in a single game?
  * **A:** No hard technical limit initially. May be revisited based on performance or matchmaking needs.

* **Q:** How should games be started? Is there a lobby system, or do players join an ongoing global game?
  * **A:** One global game running on the homepage that everyone joins. Players log in with a username for leaderboard/point tracking.

* **Q:** Are there any specific visual or user experience elements you have in mind for the frontend?
  * **A:** Modern, clean Minesweeper theme. Point drop animations on score gain. Real-time leaderboard displayed alongside the game, updating as scores change.

* **Q:** Do you have a preference for a specific cloud provider (AWS, GCP, Azure) or database (PostgreSQL is suggested, but others are possible)?
  * **A:** No preference.

These requirements provide a foundation for the project's development, establishing key features and behaviors that will guide our implementation.