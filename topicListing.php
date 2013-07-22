<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("topic.php");
require_once("category.php");
require_once("function.php");


if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$topics = Topic::find_all();
?>

<table class="table">
	<thead>
		<tr>
			<td>Category</td>
			<td>Topic</td>
			<td>Created</td>
			<td>Actions</td>
		</tr>
	</thead>
	<tbody>
		<?php
			foreach($topics as $topic){
				$category = Category::find_by_id($topic->category_id);

				echo "<tr>";
					echo "<td>" . $category->category_title . "</td>";
					echo "<td>" . $topic->topic_title . "</td>";
					echo "<td>" . $topic->topic_date . "</td>";	
					echo "<td><a id=\"editTopic-" . $topic->id . "\" href=\"editTopic.php?topicId=" . $topic->id . "\"><button type=\"button\" class=\"btn btn-warning\">Edit</button></a>" . ' ' . 
			     "<a id=\"deleteTopic-" . $topic->id . "\" href=\"deleteTopic.php?topicId=" . $topic->id . "\"><button type=\"button\" class=\"btn btn-danger\">Delete</button>". "</td>";
					echo "</tr>";			
			}
		?>
	</tbody>
</table>


<script>
	$("#topicsListingBlock").unbind();
	$('#topicsListingBlock').on("click",'a[id*="editTopic"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('22');

		id = $(this).attr('id');
		topicIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		$('#addEditTopicsBlock').load('editTopic.php', {topicId:topicIdValue});

	});


	$('#topicsListingBlock').on("click",'a[id*="deleteTopic"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('delete topic');

		id = $(this).attr('id');
		topicIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		deleteTopicData(topicIdValue);
	});

	function deleteTopicData(topicIdValue){
		$.ajax({
			type:'POST',
			url: 'topicDelete.php',
			data:{topicid:topicIdValue},
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Topic deleted!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#topicsListingBlock").load("topicListing.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Topic could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadTopicForm"]')[0].reset();
			}
		});
	};
</script>