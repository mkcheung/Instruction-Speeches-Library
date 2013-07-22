<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
require_once("function.php");
require_once("Session.php");
require_once("Post.php");
require_once("Video.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

if(isset($_POST['topic_id'])){
	$topic_id = $_POST['topic_id'];

	$speechVideo = Topic::find_by_id($topic_id);
}	
?>
<div class="container">
	<div id="videoSectionNoteView">
		<video width="640" height="480" controls>
			<?="<source src=\"../videos/". $speechVideo->video_name . "\" type=\"" . $speechVideo->video_type ."\">";?>
		</video>
	</div>
</div>

