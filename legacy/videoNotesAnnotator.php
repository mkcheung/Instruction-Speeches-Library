<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
require_once("notes.php");
require_once("function.php");
require_once("Session.php");
require_once("Post.php");
require_once("Video.php");


if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$cid = $_GET['catId'];
$topId = $_GET['topId'];
$vidId = $_GET['vidId'];
$userId = $_SESSION['user_id'];

$speechVideo = Topic::find_by_id($topId);
$allRelatedPosts = Post::find_posts_by_category_and_topic($cid, $topId);

$category = Category::find_by_id($speechVideo->category_id);

$notes = Note::find_notes_by_topic_id($topId);

foreach($allRelatedPosts as $post){
	$poster[$post->post_creator] = User::find_by_id($post->post_creator);
}
?>

<div class="container-fluid">
 	<div class="row-fluid">
 		<div class="span2">		
 			<ul class="nav nav-list navMenu">
			 	<li class="nav-header">
			 		Toastmasters Library
			 	</li>
				<li>
					<a href="logout.php">Logout</a>
				</li>
				<li>
					<a href="index.php">Back To Main</a>
				</li>
			</ul>
 		</div>
 		<div class="span10 well well-large">
			<div id="videoSection">
				<div id="videoAndNotes" class="row-fluid">
					<div id="annotationBlock" class="span4">
					</div>
					<script>
						$('#annotationBlock').load('uploadNotes.php', { 'theTopicId': <?=$topId?> });
					</script>
					<div class="span8">
						<div id="theVideo">
							<video id="samp" width="640" height="480" controls>
								<source src="../videos/<?=$speechVideo->video_name?>" type="<?=$speechVideo->video_type?>">
							</video>
						</div>
					</div>
				</div>

			</div>
			<div class="row-fluid">
				<div class="span12">
					<div id="notesListingBlock">
					</div>
					<script>
						$('#notesListingBlock').load('noteListing.php', { 'theTopicId': <?=$topId?> });
					</script>
				</div>
			</div>
		</div>
	</div>
</div>
<?php
include_once("footer.php");
?>