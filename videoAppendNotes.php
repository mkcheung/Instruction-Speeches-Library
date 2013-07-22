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
// include_once("header.php");

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

foreach($allRelatedPosts as $post){
	$poster[$post->post_creator] = User::find_by_id($post->post_creator);
}
?>

<div class="container">
	<div id="videoSection">
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
					echo $speechVideo->description ;
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

		?>
	</div>
</div>
<?php
include_once("footer.php");
?>