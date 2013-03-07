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
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$cid = $_GET['catId'];
$topId = $_GET['topId'];
$vidId = $_GET['vidId'];
$userId = $_SESSION['user_id'];

$speechVideo = Topic::find_by_id($topId);//Video::find_by_id($vidId);
$allRelatedPosts = Post::find_posts_by_category_and_topic($cid, $topId);
// echo $topId->category_id;
$category = Category::find_by_id($speechVideo->category_id);
?>

<div class="container">

<?php
	echo "<div id=\"videoAndNotes\">";
		echo "<div id=\"theVideo\">";
			echo "<video width=\"640\" height=\"480\" controls>" ;
			echo "<source src=\"../videos/". $speechVideo->video_name . "\" type=\"" . $speechVideo->video_type ."\">";
			echo "</video>";
		echo "</div>";
		echo "<div id=\"theNotes\">";
			echo "<div id=\"test\"";
				echo "</br><a href=\"#\" id=\"element\" rel=\"tooltip\" data-placement=\"right\" data-original-title=\"first tooltip\">Vocal Intonations</a>";
			echo "</div>";
		echo "</div>";
	echo "</div>";

	echo "<div id=\"topicDescription\">";

		echo "<div id=\"topicPreamble\">";
			echo "<h4>" . $speechVideo->topic_title . "</h4></br>";
			echo $speechVideo->topic_date . " </br>";
			echo "<div>" . $speechVideo->description . "</div></br>";
		echo "</div>";
		echo "<div id=\"topicNavTemp\">";
		echo "<h4>Navigator Placement</h4></br>";
		echo "test";
		echo "</div>";
		echo "<div id=\"topicCategoryInfo\">";
			echo "<h4>Speech Category</h4></br>";
			echo $category->category_title . " </br>";
			echo $category->category_description . " </br>";
		echo "</div>";	

	echo "</div>";

	echo "<div id=\"forumPostsSection\">";
	if(is_null($allRelatedPosts)){
		echo "<b>No Posts For Video</b></br>";
	} else {
		foreach($allRelatedPosts as $relatedPost){
			
		}
	}
	echo "</div>";
?>





<form id="forumPostForm" action="viewTopicVideo.php" method="post">
	<legend>New Post</legend>
	Post:<textarea name="post_content" id="post_content" rows="5" cols="100"></textarea></br>
	<?php
		echo "<input type=\"hidden\" name=\"category_id\" id=\"category_id\" value=\"" . $cid . "\"/></br>";
		echo "<input type=\"hidden\" name=\"topic_id\" id=\"topic_id\" value=\"" . $topId . "\"/></br>";
		echo "<input type=\"hidden\" name=\"post_creator\" id=\"post_creator\" value=\"" . $userId . "\"/></br>";
	?>
	<input type="submit" name="submit" value="submit"/>
</form>

</div>
<?php
include_once("footer.php");
?>